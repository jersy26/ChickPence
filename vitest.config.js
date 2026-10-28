import { defineConfig } from 'vitest/config';

// The farm's time zone (UTC+8, no daylight saving): dates typed before 8 AM are
// where the local date and the UTC date differ, so tests check them on any machine
process.env.TZ = 'Asia/Manila';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.js']
  }
});
