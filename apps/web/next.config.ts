import type { NextConfig } from 'next';

const config: NextConfig = {
  // The H5P runtime is a separate origin (:8080). Nothing is proxied through
  // Next on purpose: the spike needs to observe real cross-origin behaviour.
  env: {
    NEXT_PUBLIC_H5P_RUNTIME_URL:
      process.env.NEXT_PUBLIC_H5P_RUNTIME_URL ?? 'http://localhost:8080'
  }
};

export default config;
