import { InquiryEntity } from '../src/inquiries/inquiry.entity';
import assert from 'node:assert/strict';
import { JwtService } from '@nestjs/jwt';
import db from '../src/database/data-source';
import { UserEntity, UserStatus } from '../src/users/user.entity';
async function main() {
  await db.initialize();
  try {
    const users = await db.manager.find(UserEntity, {
      relations: { roles: true },
    });
    const actor = users.find(
      (u) =>
        u.status === UserStatus.Enabled &&
        u.roles.some((r) => r.code === 'COORDINATOR') &&
        !u.roles.some((r) => ['ROOT', 'ADMIN'].includes(r.code)),
    )!;
    const resource = users.find(
      (u) =>
        u.status === UserStatus.Enabled &&
        u.roles.length === 1 &&
        u.roles[0].code === 'RESOURCE_MANAGER',
    )!;
    assert(actor && resource);
    const jwt = new JwtService();
    const token = (id: string) =>
      jwt.sign(
        { sub: id, type: 'access' },
        { secret: process.env.JWT_SECRET!, expiresIn: '30s' },
      );
    const base = `http://127.0.0.1:${process.env.PORT ?? 4000}/api`;
    assert.equal((await fetch(`${base}/inquiries`)).status, 401);
    assert.equal(
      (
        await fetch(`${base}/inquiries`, {
          headers: { Authorization: `Bearer ${token(resource.id)}` },
        })
      ).status,
      403,
    );
    const headers = { Authorization: `Bearer ${token(actor.id)}` };
    for (const path of [
      '/inquiries?page=1&pageSize=10',
      '/inquiries/owners',
      '/inquiry-logs?page=1&pageSize=10',
      '/inquiry-logs/report',
      '/inquiry-logs/operators',
      '/resources/selections/agencies?page=1&pageSize=10',
    ]) {
      const response = await fetch(`${base}${path}`, { headers });
      assert.equal(response.status, 200, `${path}: expected HTTP 200`);
      const body = (await response.json()) as { code: string; data: unknown };
      assert.equal(body.code, 'SUCCESS');
      assert(body.data !== undefined);
    }
    assert.equal(
      (
        await fetch(`${base}/inquiries`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerId: resource.id, actorId: actor.id }),
        })
      ).status,
      400,
    );
    const admin = users.find((u) =>
      u.roles.some((r) => ['ROOT', 'ADMIN'].includes(r.code) && r.isEnabled),
    );
    assert(admin);
    const record = await db.manager.findOne(InquiryEntity, {
      where: {},
      order: { createdAt: 'DESC' },
    });
    assert(record);
    const adminHeaders = { Authorization: `Bearer ${token(admin.id)}` };
    const read = async (path: string) => {
      const response = await fetch(`${base}${path}`, { headers: adminHeaders });
      assert.equal(response.status, 200, path);
      return (await response.json()) as {
        data: {
          total: number;
          totalOperations: number;
          list: { code: string; inquiryCode: string }[];
        };
      };
    };
    const list = await read(`/inquiries?code=${record.code.toLowerCase()}`);
    assert.equal(list.data.total, 1);
    assert.equal(list.data.list[0].code, record.code);
    assert.equal((await read('/inquiries?code=NO-SUCH-CODE')).data.total, 0);
    const logs = await read(
      `/inquiry-logs?inquiryCode=${record.code.toLowerCase()}`,
    );
    const report = await read(
      `/inquiry-logs/report?inquiryCode=${record.code.toLowerCase()}`,
    );
    assert(logs.data.total > 0);
    assert.equal(logs.data.total, report.data.totalOperations);
    assert(logs.data.list.every((row) => row.inquiryCode === record.code));
    console.log(
      JSON.stringify({
        result: 'passed',
        checks: [
          'unauthenticated 401',
          'resource role 403',
          'coordinator routes and resource options 200',
          'SUCCESS envelope',
          'inquiry code exact filter',
          'log code filter and matching report',
          'invalid/spoofed input 400',
        ],
        mutations: 'none',
      }),
    );
  } finally {
    await db.destroy();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
