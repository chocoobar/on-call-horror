const isGhPages = process.env.GITHUB_PAGES === "true";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "export",
  // Serve each route as <route>/index.html so GitHub Pages' plain static
  // file server resolves directory-style URLs correctly.
  trailingSlash: true,
  // Project pages are served at https://<user>.github.io/<repo>/, not the
  // domain root, so asset/link paths need the repo name prefixed - but only
  // for that build, not local dev (`npm run dev`) or `npm run build` alone.
  basePath: isGhPages ? "/on-call-horror" : "",
  assetPrefix: isGhPages ? "/on-call-horror/" : "",
};

export default nextConfig;
