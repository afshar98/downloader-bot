/* global process, Buffer, setInterval, clearInterval */
const mode = process.argv[2] ?? 'valid';

if (mode === 'valid') {
  process.stdout.write('{"id":"fixture","formats":[]}');
} else if (mode === 'non-zero') {
  process.stderr.write('ERROR: Too Many Requests (429)');
  process.exitCode = 2;
} else if (mode === 'malformed') {
  process.stdout.write('{not-json');
} else if (mode === 'oversized') {
  process.stdout.write('x'.repeat(4096));
} else if (mode === 'binary') {
  process.stdout.write(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]));
} else if (mode === 'wait') {
  const timer = setInterval(() => process.stdout.write('.'), 1000);
  process.on('SIGTERM', () => {
    clearInterval(timer);
    process.exit(0);
  });
}
