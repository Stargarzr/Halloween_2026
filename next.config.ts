import type {NextConfig} from 'next';
// outputFileTracingExcludes keeps the 18 MB PGlite package out of the serverless function bundle; it is only imported
// on the local-preview path, which resolves it from node_modules at dev time (Performance 8).
const nextConfig:NextConfig={agentRules:false,typescript:{tsconfigPath:process.env.CONTEST_TEST_TSCONFIG||'tsconfig.json'},distDir:process.env.CONTEST_TEST_BUILD_DIR||'.next',serverExternalPackages:['pg','@electric-sql/pglite'],outputFileTracingExcludes:{'*':['./node_modules/@electric-sql/pglite/**']}};
export default nextConfig;
