import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next's dev-only route indicator defaults to bottom-left, which sits
  // directly on top of the sidebar's account block (also bottom-left) —
  // not a product element, just a dev tool overlapping one. Moving it
  // out of the way instead of disabling it keeps the route/build info
  // available. Revisit if a bottom-right toast system is added later.
  devIndicators: {
    position: "bottom-right",
  },
};

export default nextConfig;
