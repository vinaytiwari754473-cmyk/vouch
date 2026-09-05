import { env } from 'cloudflare:workers';
import { hostedAgentPost, type HostedAgentEnv } from '../../../hosted-agent';
export const dynamic = 'force-dynamic';
export function POST(request: Request) { return hostedAgentPost(request, env as HostedAgentEnv); }
