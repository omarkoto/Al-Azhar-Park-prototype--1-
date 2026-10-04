// Side-effect import: must be the FIRST import in every entry point (main.ts, seed, scripts).
// It fills process.env from backend/.env (development only) before any other module reads it.
import { loadEnvFile } from './load-env';

loadEnvFile();
