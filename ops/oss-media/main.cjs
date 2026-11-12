require('./relay.cjs').main().catch(() => { console.error('OSS relay startup failed'); process.exit(1); });
