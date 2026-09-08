/**
 * Point every test at an empty toolkit home and clear the environment
 * overrides, so a developer's real `~/.linkedin-toolkit` can never change what
 * a test sees — and a test can never write to it.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.LINKEDIN_TOOLKIT_HOME = mkdtempSync(join(tmpdir(), 'lit-node-client-'));
delete process.env.LINKEDIN_TOOLKIT_URL;
delete process.env.LINKEDIN_TOOLKIT_TOKEN;
