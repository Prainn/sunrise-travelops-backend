/** Explicit development maintenance only. Dry-run by default; keep private before-images outside Git. */
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { parse } = require('dotenv');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const out = args.find((arg) => arg.startsWith('--backup='))?.slice(9);
const e = parse(fs.readFileSync(path.resolve(__dirname, '../.env')));
if (e.DATABASE_HOST !== 'api-dev.sunrisevacation.cn' || e.DATABASE_NAME !== 'travelops_dev') throw Error('Only the exact development host/database is supported');
if (apply && (!out || !path.isAbsolute(out))) throw Error('Apply requires an absolute --backup= path outside Git');
const c = new Client({ host:e.DATABASE_HOST, port:Number(e.DATABASE_PORT), database:e.DATABASE_NAME, user:e.DATABASE_USER, password:e.DATABASE_PASSWORD, ssl:{ca:fs.readFileSync(e.DATABASE_SSL_CA,'utf8'),rejectUnauthorized:true}, connectionTimeoutMillis:10000 });
async function main() {
  try {
    await c.connect();
    await c.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    await c.query("SET LOCAL lock_timeout='10s'");
    if ((await c.query('SELECT current_database() AS db')).rows[0].db !== 'travelops_dev') throw Error('Wrong database');
    if (apply) await c.query('LOCK TABLE inquiries, website_inquiries, tours, business_code_counters, website_config_current IN SHARE ROW EXCLUSIVE MODE');
    const rows = (await c.query(`SELECT 'inquiries' AS source,id,code,version,created_at,updated_at,(created_at AT TIME ZONE 'Asia/Shanghai')::date::text AS day FROM inquiries
      UNION ALL SELECT 'website_inquiries',id,code,version,created_at,updated_at,(created_at AT TIME ZONE 'Asia/Shanghai')::date::text FROM website_inquiries
      ORDER BY day,created_at,id,source`)).rows;
    const counts = new Map();
    const mapping = rows.map(row => { const n=(counts.get(row.day)||0)+1; counts.set(row.day,n); return {...row,newCode:`INQ-${row.day.replaceAll('-','')}-${String(n).padStart(2,'0')}`}; });
    const changed = mapping.filter(row=>row.code!==row.newCode);
    const tourRows = (await c.query('SELECT id,inquiry_id,inquiry_code,version,updated_at,source_module,tour_no FROM tours WHERE inquiry_id IS NOT NULL')).rows;
    const configs = (await c.query('SELECT c.business_unit,c.version,v.config FROM website_config_current c JOIN website_config_versions v ON v.version=c.version ORDER BY c.business_unit')).rows;
    const configChanges=[];
    const tokens=text=>[...new Set([...text.matchAll(/\{([^{}]+)\}/g)].map(m=>m[1]))].sort().join(',');
    for(const row of configs) {
      const next=structuredClone(row.config); const edits=[];
      for(const t of next.templates) {
        if(t.code==='arrival-basic') { t.zh='抵达{city}。'; t.en='Arrival in {city}.'; }
        if(t.code==='guide') { t.zh='包含{language}导游服务。';t.en='Guide service in {language} is included.'; }
        if(tokens(t.zh)!==tokens(t.en)) {
          // Only repair the exact disabled acceptance fixture; never guess authored business copy.
          if(t.status!=='disabled' || !/验收|Acceptance/i.test(t.name)) throw Error(`Unresolved template variables: ${row.business_unit}/${t.code}`);
          t.en=t.en.replaceAll('{attraction}','{city}');
          if(tokens(t.zh)!==tokens(t.en)) throw Error(`Cannot repair acceptance fixture: ${t.code}`);
        }
        const old=row.config.templates.find(item=>item.id===t.id);
        if(JSON.stringify(old)!==JSON.stringify(t)) edits.push({id:t.id,code:t.code});
      }
      if(edits.length) configChanges.push({businessUnit:row.business_unit,oldVersion:row.version,next,edits});
    }
    console.log(JSON.stringify({database:'travelops_dev',inquiries:rows.length,renumber:changed.length,days:counts.size,sourceCounts:Object.fromEntries(['inquiries','website_inquiries'].map(source=>[source,rows.filter(row=>row.source===source).length])),templates:configChanges.map(({businessUnit,oldVersion,edits})=>({businessUnit,oldVersion,edits})),apply}));
    if(!apply) { await c.query('ROLLBACK'); return; }
    const backup={database:'travelops_dev',createdAt:new Date().toISOString(),mapping,tours:tourRows,configs,counters:(await c.query("SELECT * FROM business_code_counters WHERE prefix='INQ'")).rows};
    fs.mkdirSync(path.dirname(out),{recursive:true,mode:0o700});
    fs.writeFileSync(out,JSON.stringify(backup,null,2),{mode:0o600,flag:'wx'});
    for(const row of changed) await c.query(`UPDATE ${row.source} SET code=$1 WHERE id=$2`,[`RENUMBER-${row.id}`,row.id]);
    for(const row of changed) {
      await c.query(`UPDATE ${row.source} SET code=$1,version=version+1,updated_at=now() WHERE id=$2`,[row.newCode,row.id]);
      await c.query('UPDATE tours SET inquiry_code=$1,version=version+1,updated_at=now() WHERE inquiry_id=$2 AND inquiry_code IS DISTINCT FROM $1',[row.newCode,row.id]);
    }
    for(const [day,last] of counts) await c.query(`INSERT INTO business_code_counters(prefix,day,last_value) VALUES('INQ',$1,$2) ON CONFLICT(prefix,day) DO UPDATE SET last_value=greatest(business_code_counters.last_value,excluded.last_value)`,[day,last]);
    const mango=(await c.query("SELECT id FROM users WHERE username='mango' AND deleted_at IS NULL")).rows;
    if(mango.length!==1) throw Error('Mango identity ambiguous');
    for(const change of configChanges) {
      const version=(await c.query("SELECT nextval('website_config_version_seq')::integer AS v")).rows[0].v;
      change.next.version=version;
      await c.query('INSERT INTO website_config_versions(version,config,created_by,business_unit) VALUES($1,$2::jsonb,$3,$4)',[version,JSON.stringify(change.next),mango[0].id,change.businessUnit]);
      await c.query('UPDATE website_config_current SET version=$1 WHERE business_unit=$2',[version,change.businessUnit]);
    }
    const codes=(await c.query('SELECT code FROM inquiries UNION ALL SELECT code FROM website_inquiries')).rows.map(row=>row.code);
    if(codes.length!==new Set(codes).size || codes.some(code=>!/^INQ-\d{8}-\d{2,}$/.test(code))) throw Error('Post-update numbering verification failed');
    await c.query('COMMIT');
    fs.writeFileSync(`${out}.receipt.json`,JSON.stringify({committedAt:new Date().toISOString(),renumbered:changed.length,uniqueCodes:codes.length,configVersions:configChanges.map(row=>({businessUnit:row.businessUnit,version:row.next.version}))},null,2),{mode:0o600,flag:'wx'});
    console.log('Committed and verified; historical audit/frozen snapshots were not rewritten.');
  } catch(err) { await c.query('ROLLBACK').catch(()=>{});throw err; } finally { await c.end(); }
}
main().catch(err=>{console.error(err.message);process.exitCode=1;});
