// Offline smoke test preloader. An attempted outbound request must fail the test,
// even if application code catches network errors.
import https from 'node:https';
import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
const reject = () => { process.stderr.write('UNEXPECTED_NETWORK_ATTEMPT\n'); process.exit(91); };
https.request = reject;
https.get = reject;
http.request = reject;
http.get = reject;
globalThis.fetch = reject;
syncBuiltinESMExports();
