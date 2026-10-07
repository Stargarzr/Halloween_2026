import type {NextConfig} from 'next';
const nextConfig:NextConfig={distDir:process.env.CONTEST_TEST_BUILD_DIR||'.next',serverExternalPackages:['pg','@electric-sql/pglite'],experimental:{serverActions:{bodySizeLimit:'5mb'}}};
export default nextConfig;
