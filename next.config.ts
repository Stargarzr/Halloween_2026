import type {NextConfig} from 'next';
const nextConfig:NextConfig={agentRules:false,typescript:{tsconfigPath:process.env.CONTEST_TEST_TSCONFIG||'tsconfig.json'},distDir:process.env.CONTEST_TEST_BUILD_DIR||'.next',serverExternalPackages:['pg','@electric-sql/pglite'],experimental:{serverActions:{bodySizeLimit:'5mb'}}};
export default nextConfig;
