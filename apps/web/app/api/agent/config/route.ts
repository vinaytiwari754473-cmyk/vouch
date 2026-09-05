import { env } from 'cloudflare:workers';
import { hostedAgentConfig, type HostedAgentEnv } from '../../../hosted-agent';
export const dynamic = 'force-dynamic';
export function GET() { return hostedAgentConfig(env as HostedAgentEnv); }
