import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './server/memory/schema.ts',
  out: './server/memory/migrations',
  dbCredentials: {
    url: './server/data/equra-memory.db',
  },
});
