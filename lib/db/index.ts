import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from './schema';

// neon-serverless는 WebSocket으로 붙어 트랜잭션을 지원한다(neon-http는 불가).
// Node 런타임에는 전역 WebSocket이 없어 ws를 주입한다.
neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
export const db = drizzle(pool, { schema });
