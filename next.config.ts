import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse (via pdfjs-dist) ships a worker file it expects to resolve
  // relative to node_modules at runtime; bundling it breaks that. Keep it
  // external so Node's normal `require`/`import` resolution handles it.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],

  // Baseline security headers — see SECURITY.md. CSP here is intentionally
  // permissive (script-src/style-src allow 'unsafe-inline') rather than a
  // strict nonce-based policy, since the app leans on React inline
  // `style={{...}}` throughout and Next.js's own hydration script; it
  // still meaningfully restricts remote script/object sources,
  // clickjacking (frame-ancestors), and cross-origin form/base injection.
  async headers() {
    // 'unsafe-eval' is dev-only: React's dev build uses eval() for stack
    // trace reconstruction (never in production — see React's own
    // console warning). Keeping it out of the production policy matters;
    // dev-mode CSP strictness doesn't.
    const scriptSrc = ["'self'", "'unsafe-inline'", ...(process.env.NODE_ENV !== "production" ? ["'unsafe-eval'"] : [])];

    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              `script-src ${scriptSrc.join(" ")}`,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
