#!/usr/bin/env node
/**
 * Validates every sequence template in this folder against schema.json.
 *
 * Zero dependencies on purpose: this runs in CI before anything is installed, and a sequence
 * template is content, not code. The validator implements the subset of JSON Schema 2020-12 that
 * schema.json actually uses (type, required, properties, additionalProperties, enum, const,
 * items, minItems, maxItems, uniqueItems, minLength, maxLength, minimum, $ref to #/$defs, allOf,
 * if/then), plus the house rules that a schema cannot express.
 *
 *   node sequences/validate.mjs          # validate every *.json except schema.json
 *   node sequences/validate.mjs a.json   # validate specific files
 *
 * Exits non-zero on the first file with errors, after reporting all of them.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_FILE = join(HERE, 'schema.json');

/* ------------------------------------------------------------------ schema */

const schema = JSON.parse(readFileSync(SCHEMA_FILE, 'utf8'));

function resolveRef(ref, root) {
  if (!ref.startsWith('#/')) throw new Error(`unsupported $ref: ${ref}`);
  return ref
    .slice(2)
    .split('/')
    .reduce((node, key) => {
      if (node === undefined) throw new Error(`unresolvable $ref: ${ref}`);
      return node[key.replace(/~1/g, '/').replace(/~0/g, '~')];
    }, root);
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function typeMatches(value, expected) {
  const actual = typeOf(value);
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  return actual === expected;
}

/** Returns an array of error strings. Empty means valid. */
function validate(value, node, path, root, errors = []) {
  if (node === true || node === undefined) return errors;
  if (node === false) {
    errors.push(`${path}: schema forbids any value here`);
    return errors;
  }

  if (node.$ref) return validate(value, resolveRef(node.$ref, root), path, root, errors);

  if (node.type && !typeMatches(value, node.type)) {
    errors.push(`${path}: expected ${node.type}, got ${typeOf(value)}`);
    return errors; // further keywords would only produce noise
  }

  if (node.const !== undefined && value !== node.const) {
    errors.push(`${path}: expected the constant ${JSON.stringify(node.const)}`);
  }

  if (node.enum && !node.enum.includes(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} is not one of ${node.enum.join(', ')}`);
  }

  if (typeof value === 'string') {
    if (node.minLength !== undefined && value.length < node.minLength) {
      errors.push(`${path}: ${value.length} characters, minimum is ${node.minLength}`);
    }
    if (node.maxLength !== undefined && value.length > node.maxLength) {
      errors.push(`${path}: ${value.length} characters, maximum is ${node.maxLength}`);
    }
    if (node.pattern && !new RegExp(node.pattern).test(value)) {
      errors.push(`${path}: does not match /${node.pattern}/`);
    }
  }

  if (typeof value === 'number') {
    if (node.minimum !== undefined && value < node.minimum) {
      errors.push(`${path}: ${value} is below the minimum ${node.minimum}`);
    }
    if (node.maximum !== undefined && value > node.maximum) {
      errors.push(`${path}: ${value} is above the maximum ${node.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (node.minItems !== undefined && value.length < node.minItems) {
      errors.push(`${path}: ${value.length} items, minimum is ${node.minItems}`);
    }
    if (node.maxItems !== undefined && value.length > node.maxItems) {
      errors.push(`${path}: ${value.length} items, maximum is ${node.maxItems}`);
    }
    if (node.uniqueItems) {
      const seen = new Set(value.map((v) => JSON.stringify(v)));
      if (seen.size !== value.length) errors.push(`${path}: items must be unique`);
    }
    if (node.items) {
      value.forEach((item, i) => validate(item, node.items, `${path}[${i}]`, root, errors));
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of node.required ?? []) {
      if (!(key in value)) errors.push(`${path}: missing required property "${key}"`);
    }
    if (node.properties) {
      for (const [key, sub] of Object.entries(node.properties)) {
        if (key in value) validate(value[key], sub, `${path}.${key}`, root, errors);
      }
    }
    if (node.additionalProperties === false) {
      const known = new Set(Object.keys(node.properties ?? {}));
      for (const key of Object.keys(value)) {
        if (!known.has(key)) errors.push(`${path}: unexpected property "${key}"`);
      }
    }
  }

  for (const sub of node.allOf ?? []) validate(value, sub, path, root, errors);

  if (node.if) {
    const matched = validate(value, node.if, path, root, []).length === 0;
    if (matched && node.then) validate(value, node.then, path, root, errors);
    if (!matched && node.else) validate(value, node.else, path, root, errors);
  }

  if (node.anyOf) {
    const ok = node.anyOf.some((sub) => validate(value, sub, path, root, []).length === 0);
    if (!ok) errors.push(`${path}: does not match any of the allowed shapes`);
  }

  return errors;
}

/* -------------------------------------------------------------- house rules */

const INVITE_NOTE_LIMIT = 300; // LinkedIn's own limit
const MESSAGE_LIMIT = 300; // ours: keep templates human-sized
const DAY = 86_400_000;
const OUTREACH = new Set(['invite', 'message', 'inmail', 'comment']);
const VARIABLE = /\{\{([^}]+)\}\}/g;

function walkSteps(steps, path, visit) {
  steps.forEach((step, i) => {
    visit(step, `${path}[${i}]`);
    if (step.branch) {
      walkSteps(step.branch.then ?? [], `${path}[${i}].branch.then`, visit);
      walkSteps(step.branch.else ?? [], `${path}[${i}].branch.else`, visit);
    }
  });
}

function houseRules(doc, file) {
  const errors = [];
  const slug = basename(file, '.json');

  if (doc.settings?.autopilot !== false) {
    errors.push('settings.autopilot must be false — only the user turns Autopilot on');
  }
  if (doc.settings?.stopOnReply !== true) {
    errors.push('settings.stopOnReply must be true');
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    errors.push(`filename "${slug}.json" must be a lowercase kebab-case slug`);
  }

  let hasBranch = false;
  let hasOutreach = false;
  const flat = [];

  walkSteps(doc.steps ?? [], 'steps', (step, path) => {
    flat.push({ step, path });
    if (step.type === 'branch') {
      hasBranch = true;
      if (step.branch.on !== 'replied' && step.branch.ms === undefined) {
        errors.push(`${path}.branch: "${step.branch.on}" needs an "ms" window`);
      }
    }
    if (OUTREACH.has(step.type)) hasOutreach = true;

    if (step.variants) {
      if (step.variants.length !== 2) {
        errors.push(`${path}: ${step.variants.length} variants — templates ship exactly 2`);
      }
      if (new Set(step.variants).size !== step.variants.length) {
        errors.push(`${path}: variants are identical`);
      }
      const limit = step.type === 'invite' ? INVITE_NOTE_LIMIT : MESSAGE_LIMIT;
      step.variants.forEach((text, v) => {
        if (step.type !== 'inmail' && text.length > limit) {
          errors.push(`${path}.variants[${v}]: ${text.length} characters, limit is ${limit}`);
        }
        for (const [, expr] of text.matchAll(VARIABLE)) {
          if (!expr.includes('|')) {
            errors.push(`${path}.variants[${v}]: {{${expr}}} has no |fallback`);
          }
        }
      });
    }
    if (step.note && step.variants) errors.push(`${path}: set variants or note, not both`);
    if (step.body && step.variants) errors.push(`${path}: set variants or body, not both`);
  });

  if (!hasBranch) errors.push('every template must branch (accepted / replied / notAcceptedAfterMs)');
  if (!hasOutreach) errors.push('every template must contain at least one outreach step');

  // No two outreach steps closer than 24h on the same path.
  let sinceOutreach = null;
  for (const { step, path } of flat) {
    if (step.type === 'wait' && sinceOutreach !== null) sinceOutreach += step.waitMs;
    if (OUTREACH.has(step.type)) {
      if (sinceOutreach !== null && sinceOutreach < DAY) {
        errors.push(`${path}: only ${Math.round(sinceOutreach / 3_600_000)}h since the previous outreach step — 24h minimum`);
      }
      sinceOutreach = 0;
    }
    if (step.type === 'branch') sinceOutreach = null; // paths diverge; each is checked on its own
  }

  return errors;
}

/* -------------------------------------------------------------------- main */

const argv = process.argv.slice(2);
const files = argv.length
  ? argv
  : readdirSync(HERE)
      .filter((f) => f.endsWith('.json') && f !== 'schema.json')
      .sort()
      .map((f) => join(HERE, f));

let failed = 0;
let steps = 0;

for (const file of files) {
  const name = basename(file);
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`FAIL ${name}\n  not valid JSON: ${err.message}`);
    failed += 1;
    continue;
  }

  const errors = [...validate(doc, schema, '$', schema), ...houseRules(doc, name)];
  if (errors.length) {
    failed += 1;
    console.error(`FAIL ${name}`);
    for (const e of errors) console.error(`  ${e}`);
  } else {
    let count = 0;
    walkSteps(doc.steps, 'steps', () => (count += 1));
    steps += count;
    console.log(`ok   ${name.padEnd(34)} ${String(count).padStart(2)} steps  ${doc.name}`);
  }
}

const summary = `${files.length - failed}/${files.length} templates valid, ${steps} steps`;
if (failed) {
  console.error(`\n${summary} — ${failed} failed`);
  process.exit(1);
}
console.log(`\n${summary}`);
