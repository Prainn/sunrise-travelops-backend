require('./relay.cjs').main().catch(() => {
  process.stderr.write('WhatsApp sender startup failed (details suppressed)\n');
  process.exit(1);
});
