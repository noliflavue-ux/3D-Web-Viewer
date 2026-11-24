import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { ADDITION, Brush, Evaluator, INTERSECTION, SUBTRACTION } from 'three-bvh-csg';

// ============================================================================
// OPENSCAD AST INTERPRETER + 2D/3D CSG GEOMETRY ENGINE
// Supports: variables, expressions, math/trig (degrees), vectors, ranges,
// list comprehensions, user functions, user modules + children(), for/if/let,
// translate/rotate/scale/mirror/multmatrix/color, cube/cylinder/sphere/polyhedron,
// square/circle/polygon/offset + linear_extrude/rotate_extrude,
// real 3D CSG union/difference/intersection (three-bvh-csg), hull & minkowski.
// ============================================================================

export interface ScadBuiltPart {
  geometry: THREE.BufferGeometry;
  colorHex?: number;
  opacity?: number;
  partName: string;
}

export interface ScadEvaluationOutput {
  parts: ScadBuiltPart[];
  warnings: string[];
  missingIncludes: string[];
  resolvedIncludes: string[];
  primitiveCount: number;
  extractedParameters: Record<string, number>;
}

/**
 * Extracts all `include <...>` and `use <...>` dependency paths referenced in OpenSCAD code.
 */
export function extractScadIncludePaths(scadCode: string): string[] {
  const found: string[] = [];
  // Strip comments first so commented-out includes aren't treated as required dependencies
  const stripped = scadCode
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const regex = /\b(?:include|use)\s*<([^>]+)>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(stripped)) !== null) {
    const p = match[1].trim();
    if (p && !found.includes(p)) {
      found.push(p);
    }
  }
  return found;
}

function normalizeScadPath(rawPath: string): string {
  return rawPath
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.\.?\/)+/, '')
    .replace(/^\/+/, '');
}

function getScadBasename(rawPath: string): string {
  const norm = normalizeScadPath(rawPath);
  const parts = norm.split('/');
  return parts[parts.length - 1] || norm;
}

/**
 * Resolves a requested OpenSCAD include/use path (e.g. `config.scad`, `./libs/config.scad`, `../config.scad`)
 * against a map of uploaded/workspace library files.
 */
export function resolveScadLibrarySource(
  requestedPath: string,
  libraries: Record<string, string>
): { key: string; source: string } | null {
  const entries = Object.entries(libraries);
  if (entries.length === 0) return null;

  const normReq = normalizeScadPath(requestedPath);
  const normReqLower = normReq.toLowerCase();
  const baseReqLower = getScadBasename(requestedPath).toLowerCase();
  const stemReqLower = baseReqLower.replace(/\.scad$/i, '');

  // 1. Exact normalized path match
  for (const [k, v] of entries) {
    if (normalizeScadPath(k) === normReq) return { key: k, source: v };
  }
  // 2. Case-insensitive normalized path match
  for (const [k, v] of entries) {
    if (normalizeScadPath(k).toLowerCase() === normReqLower) return { key: k, source: v };
  }
  // 3. Basename match (handles ./config.scad, ../config.scad, libs/config.scad -> config.scad)
  for (const [k, v] of entries) {
    if (getScadBasename(k).toLowerCase() === baseReqLower) return { key: k, source: v };
  }
  // 4. Stem match without .scad extension (handles project names stored without extension)
  for (const [k, v] of entries) {
    const kStem = getScadBasename(k).toLowerCase().replace(/\.scad$/i, '');
    if (kStem && kStem === stemReqLower) return { key: k, source: v };
  }

  return null;
}

function safeFinite(val: unknown, fallback: number): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function safePositive(val: unknown, fallback: number, minVal = 0.05): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(minVal, Math.abs(n));
}

type ScadVal = number | boolean | string | undefined | ScadVal[] | { __range: true; start: number; step: number; end: number };

// -----------------------------
// 1. LEXER
// -----------------------------
type TokenType =
  | 'number'
  | 'string'
  | 'ident'
  | 'op'
  | 'punct'
  | 'eof';

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

function tokenizeScad(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const ch = src[i];

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    // Line comment
    if (ch === '/' && src[i + 1] === '/') {
      i += 2;
      while (i < n && src[i] !== '\n') i++;
      continue;
    }

    // Block comment
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    // include <...> / use <...>
    if ((src.startsWith('include', i) || src.startsWith('use', i)) && /\s*</.test(src.slice(i + (src[i] === 'i' ? 7 : 3), i + 20))) {
      const kw = src[i] === 'i' ? 'include' : 'use';
      const afterKw = i + kw.length;
      if (afterKw >= n || !/[a-zA-Z0-9_$]/.test(src[afterKw])) {
        const ltIdx = src.indexOf('<', afterKw);
        const gtIdx = ltIdx >= 0 ? src.indexOf('>', ltIdx) : -1;
        if (gtIdx > ltIdx) {
          tokens.push({ type: 'ident', value: kw, pos: i });
          tokens.push({ type: 'string', value: src.slice(ltIdx + 1, gtIdx), pos: ltIdx });
          i = gtIdx + 1;
          continue;
        }
      }
    }

    // String literal
    if (ch === '"') {
      const start = i++;
      let s = '';
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < n) {
          const esc = src[++i];
          s += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc;
        } else {
          s += src[i];
        }
        i++;
      }
      i++; // skip closing quote
      tokens.push({ type: 'string', value: s, pos: start });
      continue;
    }

    // Number (including .5 and 1e-4)
    if (
      (ch >= '0' && ch <= '9') ||
      (ch === '.' && i + 1 < n && src[i + 1] >= '0' && src[i + 1] <= '9')
    ) {
      const start = i;
      while (i < n && src[i] >= '0' && src[i] <= '9') i++;
      if (i < n && src[i] === '.') {
        i++;
        while (i < n && src[i] >= '0' && src[i] <= '9') i++;
      }
      if (i < n && (src[i] === 'e' || src[i] === 'E')) {
        i++;
        if (i < n && (src[i] === '+' || src[i] === '-')) i++;
        while (i < n && src[i] >= '0' && src[i] <= '9') i++;
      }
      tokens.push({ type: 'number', value: src.slice(start, i), pos: start });
      continue;
    }

    // Identifier (supports $fn, $fa, $fs, $t, _foo)
    if (
      (ch >= 'a' && ch <= 'z') ||
      (ch >= 'A' && ch <= 'Z') ||
      ch === '_' ||
      ch === '$'
    ) {
      const start = i++;
      while (
        i < n &&
        ((src[i] >= 'a' && src[i] <= 'z') ||
          (src[i] >= 'A' && src[i] <= 'Z') ||
          (src[i] >= '0' && src[i] <= '9') ||
          src[i] === '_')
      ) {
        i++;
      }
      tokens.push({ type: 'ident', value: src.slice(start, i), pos: start });
      continue;
    }

    // Two-character operators
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
      tokens.push({ type: 'op', value: two, pos: i });
      i += 2;
      continue;
    }

    // Single-character operators
    if ('+-*/%^<>!=?:'.includes(ch)) {
      tokens.push({ type: 'op', value: ch, pos: i });
      i++;
      continue;
    }

    // Punctuation & OpenSCAD modifiers (#, %, *, !)
    if ('()[]{},;.#'.includes(ch)) {
      tokens.push({ type: 'punct', value: ch, pos: i });
      i++;
      continue;
    }

    // Unknown char: skip safely
    i++;
  }

  tokens.push({ type: 'eof', value: '', pos: n });
  return tokens;
}

// -----------------------------
// 2. AST TYPES
// -----------------------------
type ExprNode =
  | { kind: 'num'; val: number }
  | { kind: 'bool'; val: boolean }
  | { kind: 'str'; val: string }
  | { kind: 'undef' }
  | { kind: 'var'; name: string }
  | { kind: 'unary'; op: string; arg: ExprNode }
  | { kind: 'binary'; op: string; left: ExprNode; right: ExprNode }
  | { kind: 'ternary'; cond: ExprNode; thenExpr: ExprNode; elseExpr: ExprNode }
  | { kind: 'vec'; items: ExprNode[] }
  | { kind: 'range'; start: ExprNode; step?: ExprNode; end: ExprNode }
  | { kind: 'listcomp'; bindings: { name: string; expr: ExprNode }[]; cond?: ExprNode; body: ExprNode }
  | { kind: 'index'; target: ExprNode; idx: ExprNode }
  | { kind: 'member'; target: ExprNode; prop: string }
  | { kind: 'call'; name: string; args: { name?: string; expr: ExprNode }[] }
  | { kind: 'let_expr'; bindings: { name: string; expr: ExprNode }[]; body: ExprNode };

type StmtNode =
  | { kind: 'assign'; name: string; expr: ExprNode }
  | { kind: 'func_def'; name: string; params: { name: string; defaultExpr?: ExprNode }[]; body: ExprNode }
  | { kind: 'mod_def'; name: string; params: { name: string; defaultExpr?: ExprNode }[]; body: StmtNode[] }
  | { kind: 'block'; stmts: StmtNode[] }
  | { kind: 'if'; cond: ExprNode; thenBranch: StmtNode; elseBranch?: StmtNode }
  | { kind: 'for'; bindings: { name: string; expr: ExprNode }[]; body: StmtNode }
  | { kind: 'let'; bindings: { name: string; expr: ExprNode }[]; body: StmtNode }
  | { kind: 'call_stmt'; modifier?: string; name: string; args: { name?: string; expr: ExprNode }[]; child?: StmtNode }
  | { kind: 'include'; path: string; mode: 'include' | 'use' }
  | { kind: 'empty' };

// -----------------------------
// 3. RECURSIVE DESCENT PARSER
// -----------------------------
class ScadParser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  private next(): Token {
    const t = this.peek();
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }

  private match(type: TokenType, value?: string): boolean {
    const t = this.peek();
    if (t.type === type && (value === undefined || t.value === value)) {
      this.next();
      return true;
    }
    return false;
  }

  private expect(type: TokenType, value?: string): Token | null {
    const t = this.peek();
    if (t.type === type && (value === undefined || t.value === value)) {
      return this.next();
    }
    return null;
  }

  parseProgram(): StmtNode[] {
    const stmts: StmtNode[] = [];
    let guard = 0;
    while (this.peek().type !== 'eof' && guard++ < 50000) {
      const before = this.pos;
      const st = this.parseStatement();
      if (st.kind !== 'empty') stmts.push(st);
      if (this.pos === before) {
        // Safety advance on unexpected token
        this.next();
      }
    }
    return stmts;
  }

  private parseStatement(): StmtNode {
    const t = this.peek();

    if (t.type === 'eof') return { kind: 'empty' };
    if (this.match('punct', ';')) return { kind: 'empty' };

    // Block { ... }
    if (this.match('punct', '{')) {
      const stmts: StmtNode[] = [];
      while (this.peek().type !== 'eof' && !(this.peek().type === 'punct' && this.peek().value === '}')) {
        const before = this.pos;
        const s = this.parseStatement();
        if (s.kind !== 'empty') stmts.push(s);
        if (this.pos === before) this.next();
      }
      this.match('punct', '}');
      return { kind: 'block', stmts };
    }

    // include <...> / use <...>
    if (t.type === 'ident' && (t.value === 'include' || t.value === 'use') && this.peek(1).type === 'string') {
      const mode = t.value as 'include' | 'use';
      this.next();
      const pathTok = this.next();
      this.match('punct', ';'); // Tolerate optional trailing semicolon
      return { kind: 'include', path: pathTok.value, mode };
    }

    // module name(params) { ... }
    if (t.type === 'ident' && t.value === 'module') {
      this.next();
      const nameTok = this.expect('ident');
      const name = nameTok?.value || '_anon';
      const params = this.parseParamList();
      const bodyStmt = this.parseStatement();
      const body = bodyStmt.kind === 'block' ? bodyStmt.stmts : bodyStmt.kind === 'empty' ? [] : [bodyStmt];
      return { kind: 'mod_def', name, params, body };
    }

    // function name(params) = expr;
    if (t.type === 'ident' && t.value === 'function') {
      this.next();
      const nameTok = this.expect('ident');
      const name = nameTok?.value || '_fn';
      const params = this.parseParamList();
      this.match('op', '=');
      const body = this.parseExpr();
      this.match('punct', ';');
      return { kind: 'func_def', name, params, body };
    }

    // if (cond) stmt [else stmt]
    if (t.type === 'ident' && t.value === 'if') {
      this.next();
      this.match('punct', '(');
      const cond = this.parseExpr();
      this.match('punct', ')');
      const thenBranch = this.parseStatement();
      let elseBranch: StmtNode | undefined;
      if (this.peek().type === 'ident' && this.peek().value === 'else') {
        this.next();
        elseBranch = this.parseStatement();
      }
      return { kind: 'if', cond, thenBranch, elseBranch };
    }

    // for / intersection_for
    if (t.type === 'ident' && (t.value === 'for' || t.value === 'intersection_for')) {
      const isIntersection = t.value === 'intersection_for';
      this.next();
      const bindings = this.parseBindings();
      const body = this.parseStatement();
      const forNode: StmtNode = { kind: 'for', bindings, body };
      if (isIntersection) {
        return { kind: 'call_stmt', name: 'intersection', args: [], child: forNode };
      }
      return forNode;
    }

    // let (a = ..., b = ...) stmt
    if (t.type === 'ident' && t.value === 'let') {
      this.next();
      const bindings = this.parseBindings();
      const body = this.parseStatement();
      return { kind: 'let', bindings, body };
    }

    // OpenSCAD modifiers (#, %, *, !) before a module call
    let modifier: string | undefined;
    if (
      (t.type === 'punct' && t.value === '#') ||
      (t.type === 'op' && (t.value === '%' || t.value === '*' || t.value === '!'))
    ) {
      modifier = this.next().value;
    }

    // Variable assignment: ident = expr;
    if (!modifier && this.peek().type === 'ident' && this.peek(1).type === 'op' && this.peek(1).value === '=') {
      const name = this.next().value;
      this.next(); // '='
      const expr = this.parseExpr();
      this.match('punct', ';');
      return { kind: 'assign', name, expr };
    }

    // Module / primitive / transform invocation: ident(args) [; | childStmt]
    if (this.peek().type === 'ident' && this.peek(1).type === 'punct' && this.peek(1).value === '(') {
      const name = this.next().value;
      const args = this.parseArgList();
      if (this.match('punct', ';')) {
        return { kind: 'call_stmt', modifier, name, args };
      }
      const child = this.parseStatement();
      return { kind: 'call_stmt', modifier, name, args, child };
    }

    // Fallback: consume one token to avoid infinite loop
    this.next();
    return { kind: 'empty' };
  }

  private parseParamList(): { name: string; defaultExpr?: ExprNode }[] {
    const params: { name: string; defaultExpr?: ExprNode }[] = [];
    if (!this.match('punct', '(')) return params;
    while (this.peek().type !== 'eof' && !(this.peek().type === 'punct' && this.peek().value === ')')) {
      const id = this.expect('ident');
      if (!id) {
        this.next();
        continue;
      }
      let defaultExpr: ExprNode | undefined;
      if (this.match('op', '=')) {
        defaultExpr = this.parseExpr();
      }
      params.push({ name: id.value, defaultExpr });
      if (!this.match('punct', ',')) break;
    }
    this.match('punct', ')');
    return params;
  }

  private parseBindings(): { name: string; expr: ExprNode }[] {
    const bindings: { name: string; expr: ExprNode }[] = [];
    if (!this.match('punct', '(')) return bindings;
    while (this.peek().type !== 'eof' && !(this.peek().type === 'punct' && this.peek().value === ')')) {
      const id = this.expect('ident');
      if (!id) {
        this.next();
        continue;
      }
      this.match('op', '=');
      const expr = this.parseExpr();
      bindings.push({ name: id.value, expr });
      if (!this.match('punct', ',')) break;
    }
    this.match('punct', ')');
    return bindings;
  }

  private parseArgList(): { name?: string; expr: ExprNode }[] {
    const args: { name?: string; expr: ExprNode }[] = [];
    if (!this.match('punct', '(')) return args;
    while (this.peek().type !== 'eof' && !(this.peek().type === 'punct' && this.peek().value === ')')) {
      if (this.peek().type === 'ident' && this.peek(1).type === 'op' && this.peek(1).value === '=') {
        const name = this.next().value;
        this.next(); // '='
        const expr = this.parseExpr();
        args.push({ name, expr });
      } else {
        const expr = this.parseExpr();
        args.push({ expr });
      }
      if (!this.match('punct', ',')) break;
    }
    this.match('punct', ')');
    return args;
  }

  private parseExpr(): ExprNode {
    return this.parseTernary();
  }

  private parseTernary(): ExprNode {
    const cond = this.parseOr();
    if (this.match('op', '?')) {
      const thenExpr = this.parseExpr();
      this.match('op', ':');
      const elseExpr = this.parseExpr();
      return { kind: 'ternary', cond, thenExpr, elseExpr };
    }
    return cond;
  }

  private parseOr(): ExprNode {
    let left = this.parseAnd();
    while (this.match('op', '||')) {
      left = { kind: 'binary', op: '||', left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): ExprNode {
    let left = this.parseEquality();
    while (this.match('op', '&&')) {
      left = { kind: 'binary', op: '&&', left, right: this.parseEquality() };
    }
    return left;
  }

  private parseEquality(): ExprNode {
    let left = this.parseRelational();
    while (this.peek().type === 'op' && (this.peek().value === '==' || this.peek().value === '!=')) {
      const op = this.next().value;
      left = { kind: 'binary', op, left, right: this.parseRelational() };
    }
    return left;
  }

  private parseRelational(): ExprNode {
    let left = this.parseAdd();
    while (
      this.peek().type === 'op' &&
      (this.peek().value === '<' || this.peek().value === '<=' || this.peek().value === '>' || this.peek().value === '>=')
    ) {
      const op = this.next().value;
      left = { kind: 'binary', op, left, right: this.parseAdd() };
    }
    return left;
  }

  private parseAdd(): ExprNode {
    let left = this.parseMul();
    while (this.peek().type === 'op' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.next().value;
      left = { kind: 'binary', op, left, right: this.parseMul() };
    }
    return left;
  }

  private parseMul(): ExprNode {
    let left = this.parsePower();
    while (this.peek().type === 'op' && (this.peek().value === '*' || this.peek().value === '/' || this.peek().value === '%')) {
      const op = this.next().value;
      left = { kind: 'binary', op, left, right: this.parsePower() };
    }
    return left;
  }

  private parsePower(): ExprNode {
    const base = this.parseUnary();
    if (this.match('op', '^')) {
      return { kind: 'binary', op: '^', left: base, right: this.parsePower() };
    }
    return base;
  }

  private parseUnary(): ExprNode {
    if (this.peek().type === 'op' && (this.peek().value === '-' || this.peek().value === '+' || this.peek().value === '!')) {
      const op = this.next().value;
      return { kind: 'unary', op, arg: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): ExprNode {
    let node = this.parsePrimary();
    while (true) {
      if (this.match('punct', '[')) {
        const idx = this.parseExpr();
        this.match('punct', ']');
        node = { kind: 'index', target: node, idx };
      } else if (this.match('punct', '.')) {
        const prop = this.expect('ident')?.value || '';
        node = { kind: 'member', target: node, prop };
      } else {
        break;
      }
    }
    return node;
  }

  private parsePrimary(): ExprNode {
    const t = this.peek();

    if (t.type === 'number') {
      this.next();
      return { kind: 'num', val: parseFloat(t.value) };
    }
    if (t.type === 'string') {
      this.next();
      return { kind: 'str', val: t.value };
    }
    if (t.type === 'ident') {
      if (t.value === 'true') {
        this.next();
        return { kind: 'bool', val: true };
      }
      if (t.value === 'false') {
        this.next();
        return { kind: 'bool', val: false };
      }
      if (t.value === 'undef') {
        this.next();
        return { kind: 'undef' };
      }
      if (t.value === 'let' && this.peek(1).type === 'punct' && this.peek(1).value === '(') {
        this.next();
        const bindings = this.parseBindings();
        const body = this.parseExpr();
        return { kind: 'let_expr', bindings, body };
      }
      if (this.peek(1).type === 'punct' && this.peek(1).value === '(') {
        const name = this.next().value;
        const args = this.parseArgList();
        return { kind: 'call', name, args };
      }
      this.next();
      return { kind: 'var', name: t.value };
    }

    // Parenthesized expression
    if (this.match('punct', '(')) {
      const expr = this.parseExpr();
      this.match('punct', ')');
      return expr;
    }

    // Vector, Range [a:b] / [a:step:b], or List comprehension [for (...) expr]
    if (this.match('punct', '[')) {
      if (this.peek().type === 'punct' && this.peek().value === ']') {
        this.next();
        return { kind: 'vec', items: [] };
      }

      // List comprehension [for (i = ...) [if (...)] expr]
      if (this.peek().type === 'ident' && this.peek().value === 'for') {
        this.next();
        const bindings = this.parseBindings();
        let cond: ExprNode | undefined;
        if (this.peek().type === 'ident' && this.peek().value === 'if') {
          this.next();
          this.match('punct', '(');
          cond = this.parseExpr();
          this.match('punct', ')');
        }
        const body = this.parseExpr();
        this.match('punct', ']');
        return { kind: 'listcomp', bindings, cond, body };
      }

      const first = this.parseExpr();

      // Range: [start : end] or [start : step : end]
      if (this.match('op', ':')) {
        const second = this.parseExpr();
        if (this.match('op', ':')) {
          const third = this.parseExpr();
          this.match('punct', ']');
          return { kind: 'range', start: first, step: second, end: third };
        }
        this.match('punct', ']');
        return { kind: 'range', start: first, end: second };
      }

      const items: ExprNode[] = [first];
      while (this.match('punct', ',')) {
        if (this.peek().type === 'punct' && this.peek().value === ']') break;
        items.push(this.parseExpr());
      }
      this.match('punct', ']');
      return { kind: 'vec', items };
    }

    return { kind: 'undef' };
  }
}

// -----------------------------
// 4. CSG & GEOMETRY UTILITIES
// -----------------------------
const csgEvaluator = new Evaluator();
csgEvaluator.useGroups = false;

const NAMED_COLORS: Record<string, number> = {
  red: 0xef4444,
  green: 0x22c55e,
  blue: 0x3b82f6,
  yellow: 0xeab308,
  orange: 0xf97316,
  cyan: 0x06b6d4,
  magenta: 0xd946ef,
  purple: 0x9333ea,
  white: 0xf8fafc,
  black: 0x1e293b,
  gray: 0x94a3b8,
  grey: 0x94a3b8,
  silver: 0xcbd5e1,
  gold: 0xf59e0b,
  steelblue: 0x4682b4,
  royalblue: 0x2563eb,
  limegreen: 0x65a30d,
  coral: 0xfb7185,
  teal: 0x14b8a6,
};

function parseColorArg(val: ScadVal): { hex?: number; alpha?: number } {
  if (typeof val === 'string') {
    const key = val.trim().toLowerCase();
    if (key.startsWith('#') && (key.length === 7 || key.length === 4)) {
      const hexStr =
        key.length === 4
          ? key[1] + key[1] + key[2] + key[2] + key[3] + key[3]
          : key.slice(1);
      const parsed = parseInt(hexStr, 16);
      return Number.isNaN(parsed) ? {} : { hex: parsed };
    }
    return key in NAMED_COLORS ? { hex: NAMED_COLORS[key] } : {};
  }
  if (Array.isArray(val) && val.length >= 3) {
    const r = Math.max(0, Math.min(1, Number(val[0]) || 0));
    const g = Math.max(0, Math.min(1, Number(val[1]) || 0));
    const b = Math.max(0, Math.min(1, Number(val[2]) || 0));
    const a = val.length >= 4 ? Math.max(0.05, Math.min(1, Number(val[3]) || 1)) : 1;
    const c = new THREE.Color(r, g, b);
    return { hex: c.getHex(), alpha: a };
  }
  return {};
}

/**
 * Ensures any BufferGeometry has clean non-indexed position, normal, and uv attributes
 * so `three-bvh-csg` Brush evaluation never fails on mismatched attributes.
 */
function normalizeGeometryForCSG(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src.clone();
  const pos = g.getAttribute('position');
  if (!pos || pos.count < 3) {
    return g;
  }

  // Strip non-standard attributes to guarantee uniform Brush layouts
  for (const attrName of Object.keys(g.attributes)) {
    if (attrName !== 'position' && attrName !== 'normal' && attrName !== 'uv') {
      g.deleteAttribute(attrName);
    }
  }

  if (!g.getAttribute('normal')) {
    g.computeVertexNormals();
  }

  if (!g.getAttribute('uv')) {
    const uvs = new Float32Array(pos.count * 2);
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }

  g.clearGroups();
  return g;
}

function flipGeometryWinding(geom: THREE.BufferGeometry): void {
  const index = geom.getIndex();
  if (index) {
    const arr = index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const tmp = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = tmp;
    }
    index.needsUpdate = true;
  } else {
    const pos = geom.getAttribute('position');
    if (!pos) return;
    for (let i = 0; i < pos.count; i += 3) {
      const x1 = pos.getX(i + 1), y1 = pos.getY(i + 1), z1 = pos.getZ(i + 1);
      const x2 = pos.getX(i + 2), y2 = pos.getY(i + 2), z2 = pos.getZ(i + 2);
      pos.setXYZ(i + 1, x2, y2, z2);
      pos.setXYZ(i + 2, x1, y1, z1);
    }
    pos.needsUpdate = true;
  }
  geom.computeVertexNormals();
}

function mergeBufferGeometriesSimple(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  const valid = geoms
    .map((g) => normalizeGeometryForCSG(g))
    .filter((g) => (g.getAttribute('position')?.count || 0) >= 3);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];

  let totalVerts = 0;
  for (const g of valid) {
    totalVerts += g.getAttribute('position').count;
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);

  let offset = 0;
  for (const g of valid) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const u = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      positions[(offset + i) * 3] = p.getX(i);
      positions[(offset + i) * 3 + 1] = p.getY(i);
      positions[(offset + i) * 3 + 2] = p.getZ(i);
      normals[(offset + i) * 3] = n ? n.getX(i) : 0;
      normals[(offset + i) * 3 + 1] = n ? n.getY(i) : 0;
      normals[(offset + i) * 3 + 2] = n ? n.getZ(i) : 1;
      uvs[(offset + i) * 2] = u ? u.getX(i) : 0;
      uvs[(offset + i) * 2 + 1] = u ? u.getY(i) : 0;
    }
    offset += p.count;
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return merged;
}

function performCSG(
  aGeom: THREE.BufferGeometry,
  bGeom: THREE.BufferGeometry,
  op: typeof SUBTRACTION | typeof INTERSECTION | typeof ADDITION
): THREE.BufferGeometry {
  const normA = normalizeGeometryForCSG(aGeom);
  const normB = normalizeGeometryForCSG(bGeom);
  try {
    const brushA = new Brush(normA);
    brushA.updateMatrixWorld(true);
    const brushB = new Brush(normB);
    brushB.updateMatrixWorld(true);
    const resultBrush = csgEvaluator.evaluate(brushA, brushB, op);
    const out = normalizeGeometryForCSG(resultBrush.geometry);
    out.computeVertexNormals();
    normA.dispose();
    normB.dispose();
    resultBrush.geometry.dispose();
    return out;
  } catch {
    normB.dispose();
    return normA;
  }
}

function buildConvexHull3D(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  const pts: THREE.Vector3[] = [];
  for (const g of geoms) {
    const pos = g.getAttribute('position');
    if (!pos) continue;
    // Subsample gracefully if huge mesh count so ConvexGeometry stays snappy
    const step = pos.count > 1200 ? Math.ceil(pos.count / 600) : 1;
    for (let i = 0; i < pos.count; i += step) {
      pts.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
    }
  }
  if (pts.length < 4) return null;
  try {
    const hull = new ConvexGeometry(pts);
    return normalizeGeometryForCSG(hull);
  } catch {
    return mergeBufferGeometriesSimple(geoms);
  }
}

function buildMinkowski3D(geomsA: THREE.BufferGeometry[], geomsB: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  const ptsA: THREE.Vector3[] = [];
  const ptsB: THREE.Vector3[] = [];
  for (const g of geomsA) {
    const pos = g.getAttribute('position');
    if (!pos) continue;
    const step = pos.count > 250 ? Math.ceil(pos.count / 120) : 1;
    for (let i = 0; i < pos.count; i += step) {
      ptsA.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
    }
  }
  for (const g of geomsB) {
    const pos = g.getAttribute('position');
    if (!pos) continue;
    const step = pos.count > 120 ? Math.ceil(pos.count / 64) : 1;
    for (let i = 0; i < pos.count; i += step) {
      ptsB.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
    }
  }
  if (ptsA.length === 0 || ptsB.length === 0) return mergeBufferGeometriesSimple(geomsA);

  // Deduplicate rounded vertices before computing Minkowski sum
  const dedup = (arr: THREE.Vector3[]) => {
    const seen = new Set<string>();
    const out: THREE.Vector3[] = [];
    for (const v of arr) {
      const k = `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(v);
      }
    }
    return out;
  };

  const uA = dedup(ptsA);
  const uB = dedup(ptsB);
  const sumPts: THREE.Vector3[] = [];
  for (const a of uA) {
    for (const b of uB) {
      sumPts.push(new THREE.Vector3(a.x + b.x, a.y + b.y, a.z + b.z));
      if (sumPts.length > 6000) break;
    }
    if (sumPts.length > 6000) break;
  }
  if (sumPts.length < 4) return mergeBufferGeometriesSimple(geomsA);
  try {
    const hull = new ConvexGeometry(sumPts);
    return normalizeGeometryForCSG(hull);
  } catch {
    return mergeBufferGeometriesSimple(geomsA);
  }
}

// 2D Andrew's monotone chain convex hull for 2D hull() inside linear_extrude
function convexHull2D(points: THREE.Vector2[]): THREE.Vector2[] {
  if (points.length <= 3) return points;
  const pts = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: THREE.Vector2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: THREE.Vector2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

// -----------------------------
// 5. EVALUATOR
// -----------------------------
interface EvalScope {
  vars: Record<string, ScadVal>;
  funcs: Record<
    string,
    { params: { name: string; defaultExpr?: ExprNode }[]; body: ExprNode; defScope?: EvalScope }
  >;
  mods: Record<
    string,
    { params: { name: string; defaultExpr?: ExprNode }[]; body: StmtNode[]; defScope?: EvalScope }
  >;
  parent?: EvalScope;
  callerChildren?: StmtNode[];
  callerScope?: EvalScope;
}

interface Raw3DItem {
  geom: THREE.BufferGeometry;
  colorHex?: number;
  opacity?: number;
  label: string;
}

interface Raw2DContour {
  outer: THREE.Vector2[];
  holes: THREE.Vector2[][];
}

class ScadEvaluator {
  warnings: string[] = [];
  missingIncludes: string[] = [];
  resolvedIncludes: string[] = [];
  primitiveCount = 0;
  private stepBudget = 16000;
  private rootScope: EvalScope;

  constructor(
    private paramOverrides: Record<string, number>,
    private scadLibraries: Record<string, string> = {},
    private rootSource: string = ''
  ) {
    this.rootScope = {
      vars: {
        PI: Math.PI,
        pi: Math.PI,
        $fn: 36,
        $fa: 12,
        $fs: 2,
        $t: 0,
      },
      funcs: {},
      mods: {},
    };
  }

  private createChildScope(parent: EvalScope, callerChildren?: StmtNode[], callerScope?: EvalScope): EvalScope {
    return {
      vars: {},
      funcs: {},
      mods: {},
      parent,
      callerChildren,
      callerScope,
    };
  }

  private getVar(scope: EvalScope, name: string): ScadVal {
    let cur: EvalScope | undefined = scope;
    while (cur) {
      if (name in cur.vars) return cur.vars[name];
      cur = cur.parent;
    }
    return undefined;
  }

  private getFunc(scope: EvalScope, name: string) {
    let cur: EvalScope | undefined = scope;
    while (cur) {
      if (name in cur.funcs) return cur.funcs[name];
      cur = cur.parent;
    }
    return undefined;
  }

  private getMod(scope: EvalScope, name: string) {
    let cur: EvalScope | undefined = scope;
    while (cur) {
      if (name in cur.mods) return cur.mods[name];
      cur = cur.parent;
    }
    return undefined;
  }

  private getSegments(scope: EvalScope, localFn?: number): number {
    const fn = localFn !== undefined ? localFn : Number(this.getVar(scope, '$fn') ?? 36);
    if (!Number.isFinite(fn) || fn <= 0) return 32;
    return Math.max(3, Math.min(96, Math.round(fn)));
  }

  private isTruthy(val: ScadVal): boolean {
    if (val === undefined || val === false || val === 0 || val === '') return false;
    if (Array.isArray(val) && val.length === 0) return false;
    return true;
  }

  private expandIterable(val: ScadVal): ScadVal[] {
    if (Array.isArray(val)) return val;
    if (val && typeof val === 'object' && '__range' in val) {
      const { start, step, end } = val;
      if (!Number.isFinite(start) || !Number.isFinite(step) || !Number.isFinite(end) || step === 0) {
        return [];
      }
      const out: number[] = [];
      const eps = Math.abs(step) * 1e-6;
      if (step > 0) {
        for (let v = start; v <= end + eps && out.length < 1500; v += step) {
          out.push(Number(v.toFixed(6)));
        }
      } else {
        for (let v = start; v >= end - eps && out.length < 1500; v += step) {
          out.push(Number(v.toFixed(6)));
        }
      }
      return out;
    }
    if (typeof val === 'number') return [val];
    return [];
  }

  private evalExpr(node: ExprNode, scope: EvalScope): ScadVal {
    if (--this.stepBudget <= 0) return 0;

    switch (node.kind) {
      case 'num':
        return node.val;
      case 'bool':
        return node.val;
      case 'str':
        return node.val;
      case 'undef':
        return undefined;
      case 'var':
        return this.getVar(scope, node.name);

      case 'unary': {
        const v = this.evalExpr(node.arg, scope);
        if (node.op === '!') return !this.isTruthy(v);
        if (node.op === '+') return v;
        if (node.op === '-') {
          if (typeof v === 'number') return -v;
          if (Array.isArray(v)) return v.map((x) => (typeof x === 'number' ? -x : x));
        }
        return 0;
      }

      case 'binary': {
        if (node.op === '&&') {
          return this.isTruthy(this.evalExpr(node.left, scope)) && this.isTruthy(this.evalExpr(node.right, scope));
        }
        if (node.op === '||') {
          return this.isTruthy(this.evalExpr(node.left, scope)) || this.isTruthy(this.evalExpr(node.right, scope));
        }
        const l = this.evalExpr(node.left, scope);
        const r = this.evalExpr(node.right, scope);

        if (node.op === '==') return JSON.stringify(l) === JSON.stringify(r);
        if (node.op === '!=') return JSON.stringify(l) !== JSON.stringify(r);

        // Vector + Vector / Vector * Scalar
        if (Array.isArray(l) && Array.isArray(r)) {
          if (node.op === '+') return l.map((v, i) => Number(v) + Number(r[i] ?? 0));
          if (node.op === '-') return l.map((v, i) => Number(v) - Number(r[i] ?? 0));
          if (node.op === '*') {
            // Dot product for 1D numeric vectors
            if (l.every((x) => typeof x === 'number') && r.every((x) => typeof x === 'number')) {
              return l.reduce((acc, v, i) => (acc as number) + (v as number) * ((r[i] as number) ?? 0), 0);
            }
          }
        }
        if (Array.isArray(l) && typeof r === 'number') {
          if (node.op === '*') return l.map((v) => (typeof v === 'number' ? v * r : v));
          if (node.op === '/') return l.map((v) => (typeof v === 'number' ? (r !== 0 ? v / r : 0) : v));
        }
        if (typeof l === 'number' && Array.isArray(r) && node.op === '*') {
          return r.map((v) => (typeof v === 'number' ? l * v : v));
        }

        const ln = Number(l ?? 0);
        const rn = Number(r ?? 0);
        switch (node.op) {
          case '+': return ln + rn;
          case '-': return ln - rn;
          case '*': return ln * rn;
          case '/': return rn !== 0 ? ln / rn : 0;
          case '%': return rn !== 0 ? ln % rn : 0;
          case '^': return Math.pow(ln, rn);
          case '<': return ln < rn;
          case '<=': return ln <= rn;
          case '>': return ln > rn;
          case '>=': return ln >= rn;
          default: return 0;
        }
      }

      case 'ternary':
        return this.isTruthy(this.evalExpr(node.cond, scope))
          ? this.evalExpr(node.thenExpr, scope)
          : this.evalExpr(node.elseExpr, scope);

      case 'vec':
        return node.items.map((item) => this.evalExpr(item, scope));

      case 'range': {
        const start = Number(this.evalExpr(node.start, scope) ?? 0);
        const end = Number(this.evalExpr(node.end, scope) ?? 0);
        const step = node.step ? Number(this.evalExpr(node.step, scope) ?? 1) : start <= end ? 1 : -1;
        return { __range: true, start, step, end };
      }

      case 'listcomp': {
        const out: ScadVal[] = [];
        const runBind = (idx: number, curScope: EvalScope) => {
          if (idx >= node.bindings.length) {
            if (!node.cond || this.isTruthy(this.evalExpr(node.cond, curScope))) {
              out.push(this.evalExpr(node.body, curScope));
            }
            return;
          }
          const b = node.bindings[idx];
          const iterable = this.expandIterable(this.evalExpr(b.expr, curScope));
          for (const val of iterable) {
            const nextScope = this.createChildScope(curScope);
            nextScope.vars[b.name] = val;
            runBind(idx + 1, nextScope);
            if (out.length >= 1500) break;
          }
        };
        runBind(0, scope);
        return out;
      }

      case 'index': {
        const target = this.evalExpr(node.target, scope);
        const idx = Math.floor(Number(this.evalExpr(node.idx, scope) ?? 0));
        if (Array.isArray(target)) return target[idx];
        if (typeof target === 'string') return target[idx];
        return undefined;
      }

      case 'member': {
        const target = this.evalExpr(node.target, scope);
        if (Array.isArray(target)) {
          if (node.prop === 'x') return target[0];
          if (node.prop === 'y') return target[1];
          if (node.prop === 'z') return target[2];
        }
        return undefined;
      }

      case 'let_expr': {
        const child = this.createChildScope(scope);
        for (const b of node.bindings) {
          child.vars[b.name] = this.evalExpr(b.expr, child);
        }
        return this.evalExpr(node.body, child);
      }

      case 'call':
        return this.evalFuncCall(node.name, node.args, scope);
    }
  }

  private evalFuncCall(
    name: string,
    rawArgs: { name?: string; expr: ExprNode }[],
    scope: EvalScope
  ): ScadVal {
    const posVals: ScadVal[] = [];
    const namedVals: Record<string, ScadVal> = {};
    for (const a of rawArgs) {
      const v = this.evalExpr(a.expr, scope);
      if (a.name) namedVals[a.name] = v;
      else posVals.push(v);
    }

    // Check user-defined function first
    const userFn = this.getFunc(scope, name);
    if (userFn) {
      const fnParent = userFn.defScope || scope;
      const fnScope = this.createChildScope(fnParent);
      userFn.params.forEach((p, idx) => {
        if (p.name in namedVals) fnScope.vars[p.name] = namedVals[p.name];
        else if (idx < posVals.length) fnScope.vars[p.name] = posVals[idx];
        else if (p.defaultExpr) fnScope.vars[p.name] = this.evalExpr(p.defaultExpr, fnScope);
        else fnScope.vars[p.name] = undefined;
      });
      return this.evalExpr(userFn.body, fnScope);
    }

    // Built-in OpenSCAD math functions (angles in DEGREES!)
    const DEG = Math.PI / 180;
    const RAD = 180 / Math.PI;
    const n0 = Number(posVals[0] ?? 0);
    const n1 = Number(posVals[1] ?? 0);

    switch (name) {
      case 'sin': return Math.sin(n0 * DEG);
      case 'cos': return Math.cos(n0 * DEG);
      case 'tan': return Math.tan(n0 * DEG);
      case 'asin': return Math.asin(Math.max(-1, Math.min(1, n0))) * RAD;
      case 'acos': return Math.acos(Math.max(-1, Math.min(1, n0))) * RAD;
      case 'atan': return Math.atan(n0) * RAD;
      case 'atan2': return Math.atan2(n0, n1) * RAD;
      case 'sqrt': return Math.sqrt(Math.max(0, n0));
      case 'abs': return Math.abs(n0);
      case 'sign': return Math.sign(n0);
      case 'floor': return Math.floor(n0);
      case 'ceil': return Math.ceil(n0);
      case 'round': return Math.round(n0);
      case 'pow': return Math.pow(n0, n1);
      case 'exp': return Math.exp(n0);
      case 'ln': return Math.log(Math.max(1e-9, n0));
      case 'log': return Math.log10(Math.max(1e-9, n0));
      case 'min': {
        const list = Array.isArray(posVals[0]) ? (posVals[0] as number[]) : (posVals as number[]);
        return Math.min(...list.map(Number));
      }
      case 'max': {
        const list = Array.isArray(posVals[0]) ? (posVals[0] as number[]) : (posVals as number[]);
        return Math.max(...list.map(Number));
      }
      case 'len':
        if (Array.isArray(posVals[0]) || typeof posVals[0] === 'string') return posVals[0].length;
        return 0;
      case 'norm': {
        if (Array.isArray(posVals[0])) {
          return Math.sqrt((posVals[0] as number[]).reduce((s, x) => s + Number(x) * Number(x), 0));
        }
        return Math.abs(n0);
      }
      case 'cross': {
        const a = Array.isArray(posVals[0]) ? posVals[0].map(Number) : [0, 0, 0];
        const b = Array.isArray(posVals[1]) ? posVals[1].map(Number) : [0, 0, 0];
        return [
          a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0],
        ];
      }
      case 'concat': {
        const res: ScadVal[] = [];
        for (const v of posVals) {
          if (Array.isArray(v)) res.push(...v);
          else res.push(v);
        }
        return res;
      }
      case 'is_undef': return posVals[0] === undefined;
      case 'is_num': return typeof posVals[0] === 'number';
      case 'is_list': return Array.isArray(posVals[0]);
      case 'is_bool': return typeof posVals[0] === 'boolean';
      case 'is_string': return typeof posVals[0] === 'string';
      default:
        return 0;
    }
  }

  private resolveCallArgs(
    rawArgs: { name?: string; expr: ExprNode }[],
    scope: EvalScope
  ): { pos: ScadVal[]; named: Record<string, ScadVal> } {
    const pos: ScadVal[] = [];
    const named: Record<string, ScadVal> = {};
    for (const a of rawArgs) {
      const val = this.evalExpr(a.expr, scope);
      if (a.name) named[a.name] = val;
      else pos.push(val);
    }
    return { pos, named };
  }

  private evalTransformMatrix(
    name: string,
    args: { pos: ScadVal[]; named: Record<string, ScadVal> }
  ): { mat: THREE.Matrix4; flipsWinding: boolean } {
    const mat = new THREE.Matrix4();
    let flipsWinding = false;

    if (name === 'translate') {
      const v = args.named.v ?? args.pos[0];
      if (Array.isArray(v)) {
        mat.makeTranslation(safeFinite(v[0], 0), safeFinite(v[1], 0), safeFinite(v[2], 0));
      }
    } else if (name === 'rotate') {
      const a = args.named.a ?? args.pos[0];
      const v = args.named.v ?? args.pos[1];
      if (Array.isArray(a)) {
        // OpenSCAD rotate([rx, ry, rz]) applies Rx then Ry then Rz => Rz * Ry * Rx => Euler(..., 'ZYX')
        const euler = new THREE.Euler(
          THREE.MathUtils.degToRad(Number(a[0] ?? 0)),
          THREE.MathUtils.degToRad(Number(a[1] ?? 0)),
          THREE.MathUtils.degToRad(Number(a[2] ?? 0)),
          'ZYX'
        );
        mat.makeRotationFromEuler(euler);
      } else if (typeof a === 'number') {
        const rad = THREE.MathUtils.degToRad(a);
        if (Array.isArray(v)) {
          const axis = new THREE.Vector3(Number(v[0] ?? 0), Number(v[1] ?? 0), Number(v[2] ?? 1));
          if (axis.lengthSq() > 1e-8) {
            axis.normalize();
            mat.makeRotationAxis(axis, rad);
          }
        } else {
          mat.makeRotationZ(rad);
        }
      }
    } else if (name === 'scale') {
      const v = args.named.v ?? args.pos[0];
      let sx = 1, sy = 1, sz = 1;
      if (Array.isArray(v)) {
        sx = Number(v[0] ?? 1);
        sy = Number(v[1] ?? 1);
        sz = Number(v[2] ?? 1);
      } else if (typeof v === 'number') {
        sx = sy = sz = v;
      }
      if (sx === 0) sx = 1e-4;
      if (sy === 0) sy = 1e-4;
      if (sz === 0) sz = 1e-4;
      mat.makeScale(sx, sy, sz);
      if (sx * sy * sz < 0) flipsWinding = true;
    } else if (name === 'mirror') {
      const v = args.named.v ?? args.pos[0];
      if (Array.isArray(v)) {
        const n = new THREE.Vector3(Number(v[0] ?? 0), Number(v[1] ?? 0), Number(v[2] ?? 0));
        if (n.lengthSq() > 1e-8) {
          n.normalize();
          // Householder reflection: I - 2 * n * n^T
          mat.set(
            1 - 2 * n.x * n.x, -2 * n.x * n.y, -2 * n.x * n.z, 0,
            -2 * n.y * n.x, 1 - 2 * n.y * n.y, -2 * n.y * n.z, 0,
            -2 * n.z * n.x, -2 * n.z * n.y, 1 - 2 * n.z * n.z, 0,
            0, 0, 0, 1
          );
          flipsWinding = true;
        }
      }
    } else if (name === 'multmatrix') {
      const m = args.named.m ?? args.pos[0];
      if (Array.isArray(m) && m.length >= 3) {
        const r0 = Array.isArray(m[0]) ? m[0].map(Number) : [1, 0, 0, 0];
        const r1 = Array.isArray(m[1]) ? m[1].map(Number) : [0, 1, 0, 0];
        const r2 = Array.isArray(m[2]) ? m[2].map(Number) : [0, 0, 1, 0];
        const r3 = Array.isArray(m[3]) ? m[3].map(Number) : [0, 0, 0, 1];
        mat.set(
          r0[0] ?? 1, r0[1] ?? 0, r0[2] ?? 0, r0[3] ?? 0,
          r1[0] ?? 0, r1[1] ?? 1, r1[2] ?? 0, r1[3] ?? 0,
          r2[0] ?? 0, r2[1] ?? 0, r2[2] ?? 1, r2[3] ?? 0,
          r3[0] ?? 0, r3[1] ?? 0, r3[2] ?? 0, r3[3] ?? 1
        );
        if (mat.determinant() < 0) flipsWinding = true;
      }
    }

    return { mat, flipsWinding };
  }

  /**
   * Recursively resolves `include <...>` and `use <...>` directives into the target scope,
   * returning expanded top-level statements (for `include`) while respecting OpenSCAD semantics:
   * - `include <file>`: merges variables, functions, modules AND top-level geometry into caller scope.
   * - `use <file>`: imports only functions and modules (with lexical access to the library's own variables),
   *   without executing top-level geometry of the used file.
   */
  private expandIncludes(
    stmts: StmtNode[],
    scope: EvalScope,
    visited: Set<string>,
    isUseContext: boolean
  ): StmtNode[] {
    const expanded: StmtNode[] = [];

    for (const st of stmts) {
      if (st.kind !== 'include') {
        expanded.push(st);
        continue;
      }

      const resolved = resolveScadLibrarySource(st.path, this.scadLibraries);
      if (!resolved) {
        if (!this.missingIncludes.includes(st.path)) {
          this.missingIncludes.push(st.path);
        }
        this.warnings.push(
          `Fehlende OpenSCAD-Datei „${st.path}“ — bitte über „Nachladen“ oder gemeinsam per Import hinzufügen.`
        );
        continue;
      }

      const visitKey = `${st.mode}:${normalizeScadPath(resolved.key).toLowerCase()}`;
      if (visited.has(visitKey)) {
        continue; // Guard against circular includes
      }
      visited.add(visitKey);

      if (!this.resolvedIncludes.includes(st.path)) {
        this.resolvedIncludes.push(st.path);
      }

      const libTokens = tokenizeScad(resolved.source);
      const libAst = new ScadParser(libTokens).parseProgram();

      if (st.mode === 'include' && !isUseContext) {
        // Inline included AST directly so its vars, modules, functions, and geometry execute in caller scope
        const nested = this.expandIncludes(libAst, scope, visited, false);
        for (const nst of nested) {
          expanded.push(nst);
        }
      } else {
        // `use <lib.scad>`: evaluate library definitions in a dedicated library scope,
        // then expose its functions & modules into the caller scope bound to libScope.
        const libScope = this.createChildScope(this.rootScope);
        const libExpanded = this.expandIncludes(libAst, libScope, visited, true);
        for (const lst of libExpanded) {
          if (lst.kind === 'func_def') {
            const def = { params: lst.params, body: lst.body, defScope: libScope };
            libScope.funcs[lst.name] = def;
            scope.funcs[lst.name] = def;
          } else if (lst.kind === 'mod_def') {
            const def = { params: lst.params, body: lst.body, defScope: libScope };
            libScope.mods[lst.name] = def;
            scope.mods[lst.name] = def;
          }
        }
        for (const lst of libExpanded) {
          if (lst.kind === 'assign') {
            libScope.vars[lst.name] = this.evalExpr(lst.expr, libScope);
          }
        }
      }
    }

    return expanded;
  }

  /**
   * Evaluates a list of statements in 3D space.
   * Resolves all `include`/`use` files, registers all module/function definitions and assignments
   * in a first pass (matching OpenSCAD hoisting!), then evaluates geometric statements.
   */
  public evaluateProgram(stmts: StmtNode[]): ScadEvaluationOutput {
    const scope = this.rootScope;

    // Pass 0: Resolve and inline `include <...>` and register `use <...>` modules/functions
    // Seed visited set with any library key whose content matches the root file (guards root -> B -> root cycles)
    const initialVisited = new Set<string>();
    const trimmedRoot = this.rootSource.trim();
    if (trimmedRoot) {
      for (const [k, v] of Object.entries(this.scadLibraries)) {
        if (v.trim() === trimmedRoot) {
          const normKey = normalizeScadPath(k).toLowerCase();
          initialVisited.add(`include:${normKey}`);
          initialVisited.add(`use:${normKey}`);
        }
      }
    }
    const expandedStmts = this.expandIncludes(stmts, scope, initialVisited, false);

    // Pass 1: Hoist module & function definitions and top-level variable assignments
    for (const st of expandedStmts) {
      if (st.kind === 'func_def') {
        scope.funcs[st.name] = { params: st.params, body: st.body };
      } else if (st.kind === 'mod_def') {
        scope.mods[st.name] = { params: st.params, body: st.body };
      }
    }
    for (const st of expandedStmts) {
      if (st.kind === 'assign') {
        if (st.name in this.paramOverrides) {
          scope.vars[st.name] = this.paramOverrides[st.name];
        } else {
          scope.vars[st.name] = this.evalExpr(st.expr, scope);
        }
      }
    }
    // Apply any remaining overrides not directly assigned
    for (const [k, v] of Object.entries(this.paramOverrides)) {
      scope.vars[k] = v;
    }

    // Extract top-level numeric parameters for UI sliders
    const extractedParameters: Record<string, number> = {};
    for (const [k, v] of Object.entries(scope.vars)) {
      if (typeof v === 'number' && Number.isFinite(v) && k !== 'PI' && k !== 'pi' && !k.startsWith('$')) {
        extractedParameters[k] = Number(v.toFixed(4));
      }
    }

    // Pass 2: Evaluate 3D geometry statements
    const items = this.evalStmts3D(expandedStmts, scope, 0);

    const parts: ScadBuiltPart[] = items.map((item, idx) => ({
      geometry: item.geom,
      colorHex: item.colorHex,
      opacity: item.opacity,
      partName: item.label || `SCAD Komponente #${idx + 1}`,
    }));

    return {
      parts,
      warnings: Array.from(new Set(this.warnings)),
      missingIncludes: Array.from(new Set(this.missingIncludes)),
      resolvedIncludes: Array.from(new Set(this.resolvedIncludes)),
      primitiveCount: this.primitiveCount,
      extractedParameters,
    };
  }

  private evalStmts3D(stmts: StmtNode[], scope: EvalScope, depth: number): Raw3DItem[] {
    if (depth > 64 || this.stepBudget <= 0) return [];

    // Hoist local defs & assignments inside this block
    for (const st of stmts) {
      if (st.kind === 'func_def') scope.funcs[st.name] = { params: st.params, body: st.body };
      else if (st.kind === 'mod_def') scope.mods[st.name] = { params: st.params, body: st.body };
    }
    for (const st of stmts) {
      if (st.kind === 'assign' && scope !== this.rootScope) {
        scope.vars[st.name] = this.evalExpr(st.expr, scope);
      }
    }

    const out: Raw3DItem[] = [];
    for (const st of stmts) {
      if (st.kind === 'assign' || st.kind === 'func_def' || st.kind === 'mod_def' || st.kind === 'empty') {
        continue;
      }
      if (st.kind === 'include') {
        const resolved = resolveScadLibrarySource(st.path, this.scadLibraries);
        if (resolved) {
          const nested = this.expandIncludes([st], scope, new Set<string>(), st.mode === 'use');
          const res = this.evalStmts3D(nested, scope, depth + 1);
          for (const r of res) out.push(r);
        } else {
          if (!this.missingIncludes.includes(st.path)) this.missingIncludes.push(st.path);
          this.warnings.push(
            `Fehlende OpenSCAD-Datei „${st.path}“ — bitte über „Nachladen“ oder gemeinsam per Import hinzufügen.`
          );
        }
        continue;
      }
      const res = this.evalStmt3D(st, scope, depth);
      for (const r of res) out.push(r);
      if (out.length > 500) break;
    }
    return out;
  }

  private getChildStmtList(child?: StmtNode): StmtNode[] {
    if (!child || child.kind === 'empty') return [];
    if (child.kind === 'block') return child.stmts;
    return [child];
  }

  private evalStmt3D(st: StmtNode, scope: EvalScope, depth: number): Raw3DItem[] {
    if (depth > 64 || --this.stepBudget <= 0) return [];

    switch (st.kind) {
      case 'block': {
        const blockScope = this.createChildScope(scope);
        return this.evalStmts3D(st.stmts, blockScope, depth + 1);
      }

      case 'if': {
        const cond = this.evalExpr(st.cond, scope);
        if (this.isTruthy(cond)) {
          return this.evalStmt3D(st.thenBranch, scope, depth + 1);
        }
        if (st.elseBranch) {
          return this.evalStmt3D(st.elseBranch, scope, depth + 1);
        }
        return [];
      }

      case 'for': {
        const out: Raw3DItem[] = [];
        const runLoop = (idx: number, curScope: EvalScope) => {
          if (idx >= st.bindings.length) {
            const items = this.evalStmt3D(st.body, curScope, depth + 1);
            for (const item of items) out.push(item);
            return;
          }
          const b = st.bindings[idx];
          const iterable = this.expandIterable(this.evalExpr(b.expr, curScope));
          for (const val of iterable) {
            const iterScope = this.createChildScope(curScope);
            iterScope.vars[b.name] = val;
            runLoop(idx + 1, iterScope);
            if (out.length > 500 || this.stepBudget <= 0) break;
          }
        };
        runLoop(0, scope);
        return out;
      }

      case 'let': {
        const letScope = this.createChildScope(scope);
        for (const b of st.bindings) {
          letScope.vars[b.name] = this.evalExpr(b.expr, letScope);
        }
        return this.evalStmt3D(st.body, letScope, depth + 1);
      }

      case 'call_stmt': {
        // '*' disables subtree in OpenSCAD
        if (st.modifier === '*') return [];
        const isGhost = st.modifier === '%';
        const isHighlight = st.modifier === '#';

        const args = this.resolveCallArgs(st.args, scope);
        const name = st.name;

        // 3D Primitives
        if (name === 'cube') {
          const sizeArg = args.named.size ?? args.pos[0] ?? 1;
          const center = this.isTruthy(args.named.center ?? args.pos[1] ?? false);
          let sx = 1, sy = 1, sz = 1;
          if (Array.isArray(sizeArg)) {
            if (
              !Number.isFinite(Number(sizeArg[0])) ||
              !Number.isFinite(Number(sizeArg[1])) ||
              !Number.isFinite(Number(sizeArg[2]))
            ) {
              return [];
            }
            sx = safePositive(sizeArg[0], 1);
            sy = safePositive(sizeArg[1], 1);
            sz = safePositive(sizeArg[2], 1);
          } else {
            if (!Number.isFinite(Number(sizeArg))) return [];
            const s = safePositive(sizeArg, 1);
            sx = sy = sz = s;
          }
          const geom = new THREE.BoxGeometry(sx, sy, sz);
          if (!center) {
            geom.translate(sx / 2, sy / 2, sz / 2);
          }
          this.primitiveCount++;
          return [{ geom, label: `Quader (${sx.toFixed(1)}×${sy.toFixed(1)}×${sz.toFixed(1)})` }];
        }

        if (name === 'cylinder') {
          const hasH = 'h' in args.named || args.pos.length >= 1;
          const rawH = 'h' in args.named ? args.named.h : args.pos.length >= 1 ? args.pos[0] : 1;
          if (hasH && (rawH === undefined || !Number.isFinite(Number(rawH)))) return [];
          const h = safePositive(rawH, 1);
          let r1: number | undefined;
          let r2: number | undefined;

          if ('r' in args.named) {
            r1 = r2 = Number(args.named.r);
          } else if ('d' in args.named) {
            r1 = r2 = Number(args.named.d) / 2;
          } else if ('r1' in args.named || 'r2' in args.named) {
            r1 = 'r1' in args.named ? Number(args.named.r1) : 1;
            r2 = 'r2' in args.named ? Number(args.named.r2) : 1;
          } else if ('d1' in args.named || 'd2' in args.named) {
            r1 = 'd1' in args.named ? Number(args.named.d1) / 2 : 1;
            r2 = 'd2' in args.named ? Number(args.named.d2) / 2 : 1;
          } else if (args.pos.length >= 3) {
            r1 = Number(args.pos[1]);
            r2 = Number(args.pos[2]);
          } else if (args.pos.length === 2) {
            r1 = r2 = Number(args.pos[1]);
          } else {
            r1 = r2 = 1;
          }

          if (!Number.isFinite(r1) || !Number.isFinite(r2)) return [];
          r1 = Math.max(0, Math.abs(r1));
          r2 = Math.max(0, Math.abs(r2));
          if (r1 === 0 && r2 === 0) r1 = r2 = 0.5;

          const center = this.isTruthy(args.named.center ?? (args.pos.length >= 4 ? args.pos[3] : false));
          const segs = this.getSegments(scope, args.named.$fn !== undefined ? Number(args.named.$fn) : undefined);

          // Three.js CylinderGeometry(radiusTop, radiusBottom, height): top is +Y, bottom is -Y.
          // Rotating +PI/2 around X maps +Y -> +Z (r2 at z=+h) and -Y -> -Z (r1 at z=0).
          const geom = new THREE.CylinderGeometry(r2, r1, h, segs);
          geom.rotateX(Math.PI / 2);
          if (!center) {
            geom.translate(0, 0, h / 2);
          }
          this.primitiveCount++;
          return [{ geom, label: `Zylinder (Ø${(Math.max(r1, r2) * 2).toFixed(1)}, h=${h.toFixed(1)})` }];
        }

        if (name === 'sphere') {
          let r = 1;
          if ('r' in args.named) r = Number(args.named.r);
          else if ('d' in args.named) r = Number(args.named.d) / 2;
          else if (args.pos.length >= 1) r = Number(args.pos[0]);
          if (!Number.isFinite(r)) return [];
          r = safePositive(r, 1);
          const segs = this.getSegments(scope, args.named.$fn !== undefined ? Number(args.named.$fn) : undefined);
          const geom = new THREE.SphereGeometry(r, segs, Math.max(12, Math.round(segs / 2)));
          this.primitiveCount++;
          return [{ geom, label: `Kugel (r=${r.toFixed(1)})` }];
        }

        if (name === 'polyhedron') {
          const ptsRaw = args.named.points ?? args.pos[0];
          const facesRaw = args.named.faces ?? args.named.triangles ?? args.pos[1];
          if (Array.isArray(ptsRaw) && Array.isArray(facesRaw)) {
            const verts: number[] = [];
            for (const f of facesRaw) {
              if (!Array.isArray(f) || f.length < 3) continue;
              const p0 = ptsRaw[Number(f[0])] as number[] | undefined;
              if (!Array.isArray(p0)) continue;
              for (let k = 1; k < f.length - 1; k++) {
                const p1 = ptsRaw[Number(f[k])] as number[] | undefined;
                const p2 = ptsRaw[Number(f[k + 1])] as number[] | undefined;
                if (!Array.isArray(p1) || !Array.isArray(p2)) continue;
                // OpenSCAD polyhedron faces are clockwise when viewed from outside -> reverse to CCW for Three.js
                verts.push(
                  Number(p0[0] ?? 0), Number(p0[1] ?? 0), Number(p0[2] ?? 0),
                  Number(p2[0] ?? 0), Number(p2[1] ?? 0), Number(p2[2] ?? 0),
                  Number(p1[0] ?? 0), Number(p1[1] ?? 0), Number(p1[2] ?? 0)
                );
              }
            }
            if (verts.length >= 9) {
              const geom = new THREE.BufferGeometry();
              geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
              // Ensure outward orientation via signed volume sign
              let signedVol = 0;
              for (let i = 0; i < verts.length; i += 9) {
                const x0 = verts[i], y0 = verts[i + 1], z0 = verts[i + 2];
                const x1 = verts[i + 3], y1 = verts[i + 4], z1 = verts[i + 5];
                const x2 = verts[i + 6], y2 = verts[i + 7], z2 = verts[i + 8];
                signedVol += (x0 * (y1 * z2 - z1 * y2) + y0 * (z1 * x2 - x1 * z2) + z0 * (x1 * y2 - y1 * x2)) / 6;
              }
              if (signedVol < 0) flipGeometryWinding(geom);
              geom.computeVertexNormals();
              this.primitiveCount++;
              return [{ geom: normalizeGeometryForCSG(geom), label: 'Polyeder' }];
            }
          }
          return [];
        }

        // 2D-to-3D Extrusions: linear_extrude & rotate_extrude
        if (name === 'linear_extrude') {
          const height = Math.max(0.05, Math.abs(Number(args.named.height ?? args.pos[0] ?? 10)));
          const center = this.isTruthy(args.named.center ?? false);
          const twist = Number(args.named.twist ?? 0);
          const scaleArg = args.named.scale ?? 1;
          const sx = Array.isArray(scaleArg) ? Number(scaleArg[0] ?? 1) : Number(scaleArg ?? 1);
          const sy = Array.isArray(scaleArg) ? Number(scaleArg[1] ?? sx) : sx;
          const slices = Math.max(1, Math.min(64, Math.round(Number(args.named.slices ?? (Math.abs(twist) > 1 ? Math.ceil(Math.abs(twist) / 12) : 1)))));

          const childStmts = this.getChildStmtList(st.child);
          const extruded = this.evalLinearExtrudeChildren(childStmts, scope, height, center, twist, slices, sx, sy, depth + 1);
          return extruded;
        }

        if (name === 'rotate_extrude') {
          const angleDeg = Number(args.named.angle ?? 360);
          const segs = this.getSegments(scope, args.named.$fn !== undefined ? Number(args.named.$fn) : undefined);
          const childStmts = this.getChildStmtList(st.child);
          const contours = this.evalStmts2D(childStmts, scope, depth + 1);
          const out: Raw3DItem[] = [];
          const phiLength = THREE.MathUtils.degToRad(Math.max(5, Math.min(360, Math.abs(angleDeg))));
          for (const c of contours) {
            if (c.outer.length < 3) continue;
            // Close loop for LatheGeometry: profile x = radius (>= 0), y = OpenSCAD z
            const pts = c.outer.map((p) => new THREE.Vector2(Math.max(0.001, Math.abs(p.x)), p.y));
            pts.push(pts[0].clone());
            const geom = new THREE.LatheGeometry(pts, segs, 0, phiLength);
            // Lathe revolves around +Y -> rotate +PI/2 around X to revolve around OpenSCAD +Z
            geom.rotateX(Math.PI / 2);
            geom.computeVertexNormals();
            this.primitiveCount++;
            out.push({ geom: normalizeGeometryForCSG(geom), label: 'Rotationskörper' });
          }
          return out;
        }

        // Transforms
        if (
          name === 'translate' ||
          name === 'rotate' ||
          name === 'scale' ||
          name === 'mirror' ||
          name === 'multmatrix'
        ) {
          const { mat, flipsWinding } = this.evalTransformMatrix(name, args);
          const children = this.evalStmts3D(this.getChildStmtList(st.child), scope, depth + 1);
          for (const item of children) {
            item.geom.applyMatrix4(mat);
            if (flipsWinding) flipGeometryWinding(item.geom);
            if (isGhost) item.opacity = 0.25;
            if (isHighlight) item.colorHex = 0xf43f5e;
          }
          return children;
        }

        if (name === 'resize') {
          const newSize = args.named.newsize ?? args.pos[0];
          const children = this.evalStmts3D(this.getChildStmtList(st.child), scope, depth + 1);
          if (Array.isArray(newSize) && children.length > 0) {
            const box = new THREE.Box3();
            for (const c of children) {
              c.geom.computeBoundingBox();
              if (c.geom.boundingBox) box.union(c.geom.boundingBox);
            }
            const cur = new THREE.Vector3();
            box.getSize(cur);
            const sx = Number(newSize[0] ?? 0) > 0 && cur.x > 1e-4 ? Number(newSize[0]) / cur.x : 1;
            const sy = Number(newSize[1] ?? 0) > 0 && cur.y > 1e-4 ? Number(newSize[1]) / cur.y : 1;
            const sz = Number(newSize[2] ?? 0) > 0 && cur.z > 1e-4 ? Number(newSize[2]) / cur.z : 1;
            const m = new THREE.Matrix4().makeScale(sx, sy, sz);
            for (const c of children) c.geom.applyMatrix4(m);
          }
          return children;
        }

        if (name === 'color') {
          const parsed = parseColorArg(args.named.c ?? args.pos[0]);
          const alphaArg = args.named.alpha ?? args.pos[1];
          const opacity = alphaArg !== undefined ? Math.max(0.08, Math.min(1, Number(alphaArg))) : parsed.alpha;
          const children = this.evalStmts3D(this.getChildStmtList(st.child), scope, depth + 1);
          for (const c of children) {
            if (parsed.hex !== undefined && c.colorHex === undefined) c.colorHex = parsed.hex;
            if (opacity !== undefined && opacity < 1) c.opacity = opacity;
          }
          return children;
        }

        if (name === 'render' || name === 'union') {
          const children = this.evalStmts3D(this.getChildStmtList(st.child), scope, depth + 1);
          if (isGhost) children.forEach((c) => (c.opacity = 0.25));
          return children;
        }

        // Real 3D CSG Difference
        if (name === 'difference') {
          const childStmts = this.getChildStmtList(st.child);
          const groups: Raw3DItem[][] = [];
          const diffScope = this.createChildScope(scope);
          // Hoist assignments inside difference block
          for (const cs of childStmts) {
            if (cs.kind === 'assign') diffScope.vars[cs.name] = this.evalExpr(cs.expr, diffScope);
            else if (cs.kind === 'func_def') diffScope.funcs[cs.name] = { params: cs.params, body: cs.body };
            else if (cs.kind === 'mod_def') diffScope.mods[cs.name] = { params: cs.params, body: cs.body };
          }
          for (const cs of childStmts) {
            if (cs.kind === 'assign' || cs.kind === 'func_def' || cs.kind === 'mod_def' || cs.kind === 'empty') continue;
            const res = this.evalStmt3D(cs, diffScope, depth + 1);
            if (res.length > 0) groups.push(res);
          }
          if (groups.length === 0) return [];

          // Combine base group (first child)
          const baseItems = groups[0];
          let baseGeom = mergeBufferGeometriesSimple(baseItems.map((i) => i.geom));
          if (!baseGeom) return [];

          // Subtract all subsequent groups using real 3D CSG
          for (let gIdx = 1; gIdx < groups.length; gIdx++) {
            const subGeom = mergeBufferGeometriesSimple(groups[gIdx].map((i) => i.geom));
            if (subGeom) {
              baseGeom = performCSG(baseGeom, subGeom, SUBTRACTION);
            }
          }

          return [
            {
              geom: baseGeom,
              colorHex: baseItems[0]?.colorHex,
              opacity: isGhost ? 0.25 : baseItems[0]?.opacity,
              label: baseItems[0]?.label || 'CSG Differenz-Bauteil',
            },
          ];
        }

        // Real 3D CSG Intersection
        if (name === 'intersection') {
          const childStmts = this.getChildStmtList(st.child);
          const groups: Raw3DItem[][] = [];
          const intScope = this.createChildScope(scope);
          for (const cs of childStmts) {
            if (cs.kind === 'assign') intScope.vars[cs.name] = this.evalExpr(cs.expr, intScope);
          }
          for (const cs of childStmts) {
            if (cs.kind === 'assign' || cs.kind === 'func_def' || cs.kind === 'mod_def' || cs.kind === 'empty') continue;
            const res = this.evalStmt3D(cs, intScope, depth + 1);
            if (res.length > 0) groups.push(res);
          }
          if (groups.length === 0) return [];
          let accGeom = mergeBufferGeometriesSimple(groups[0].map((i) => i.geom));
          if (!accGeom) return [];
          for (let gIdx = 1; gIdx < groups.length; gIdx++) {
            const nextGeom = mergeBufferGeometriesSimple(groups[gIdx].map((i) => i.geom));
            if (nextGeom) {
              accGeom = performCSG(accGeom, nextGeom, INTERSECTION);
            }
          }
          return [{ geom: accGeom, colorHex: groups[0][0]?.colorHex, label: 'CSG Schnittkörper' }];
        }

        // Real 3D Convex Hull
        if (name === 'hull') {
          const children = this.evalStmts3D(this.getChildStmtList(st.child), scope, depth + 1);
          if (children.length === 0) return [];
          const hullGeom = buildConvexHull3D(children.map((c) => c.geom));
          children.forEach((c) => c.geom.dispose());
          if (!hullGeom) return [];
          return [{ geom: hullGeom, colorHex: children[0]?.colorHex, label: 'Hüllkörper (hull)' }];
        }

        // Real 3D Minkowski Sum (convex approximation — exact for rounded boxes/plates/cylinders!)
        if (name === 'minkowski') {
          const childStmts = this.getChildStmtList(st.child);
          const groups: Raw3DItem[][] = [];
          for (const cs of childStmts) {
            const res = this.evalStmt3D(cs, scope, depth + 1);
            if (res.length > 0) groups.push(res);
          }
          if (groups.length === 0) return [];
          if (groups.length === 1) return groups[0];
          let acc = groups[0].map((g) => g.geom);
          for (let i = 1; i < groups.length; i++) {
            const res = buildMinkowski3D(acc, groups[i].map((g) => g.geom));
            if (res) acc = [res];
          }
          return acc.map((g) => ({ geom: g, colorHex: groups[0][0]?.colorHex, label: 'Minkowski-Körper' }));
        }

        // OpenSCAD children() inside a user module
        if (name === 'children') {
          if (!scope.callerChildren || !scope.callerScope) return [];
          if (args.pos.length > 0) {
            const idx = Math.floor(Number(args.pos[0]));
            const target = scope.callerChildren[idx];
            return target ? this.evalStmt3D(target, scope.callerScope, depth + 1) : [];
          }
          return this.evalStmts3D(scope.callerChildren, scope.callerScope, depth + 1);
        }

        // Ignore echo / assert cleanly
        if (name === 'echo' || name === 'assert') return [];

        // If user wrote a bare 2D primitive at top level, extrude it 1mm thin so it still previews visibly
        if (name === 'square' || name === 'circle' || name === 'polygon') {
          const contours = this.evalStmt2D(st, scope, depth + 1);
          return this.extrudeContours(contours, 1.2, false, 0, 1, 1, 1);
        }

        // User-defined module call
        const userMod = this.getMod(scope, name);
        if (userMod) {
          const childList = this.getChildStmtList(st.child);
          const modParent = userMod.defScope || scope;
          const modScope = this.createChildScope(modParent, childList, scope);
          // Propagate dynamic special vars ($fn, $fa, $fs, $t) from caller scope
          for (const sv of ['$fn', '$fa', '$fs', '$t']) {
            const v = this.getVar(scope, sv);
            if (v !== undefined) modScope.vars[sv] = v;
          }
          userMod.params.forEach((p, idx) => {
            if (p.name in args.named) modScope.vars[p.name] = args.named[p.name];
            else if (idx < args.pos.length) modScope.vars[p.name] = args.pos[idx];
            else if (p.defaultExpr) modScope.vars[p.name] = this.evalExpr(p.defaultExpr, modScope);
            else modScope.vars[p.name] = undefined;
          });
          // Pass special vars like $fn if explicitly provided in call args
          for (const [k, v] of Object.entries(args.named)) {
            if (k.startsWith('$')) modScope.vars[k] = v;
          }
          const items = this.evalStmts3D(userMod.body, modScope, depth + 1);
          if (isGhost) items.forEach((i) => (i.opacity = 0.25));
          return items;
        }

        // Unknown external module or unsupported command
        if (name === 'import' || name === 'surface' || name === 'text') {
          this.warnings.push(`OpenSCAD-Befehl „${name}()“ wird im Browser-Kernel nur eingeschränkt unterstützt.`);
        }
        return [];
      }

      default:
        return [];
    }
  }

  // -----------------------------
  // 2D EVALUATION + LINEAR EXTRUDE (WITH REAL 2D BOOLEAN PUSH-DOWN!)
  // -----------------------------
  private evalLinearExtrudeChildren(
    childStmts: StmtNode[],
    scope: EvalScope,
    height: number,
    center: boolean,
    twist: number,
    slices: number,
    sx: number,
    sy: number,
    depth: number
  ): Raw3DItem[] {
    // Handle top-level 2D difference/intersection by pushing extrusion down into real 3D CSG!
    if (childStmts.length === 1 && childStmts[0].kind === 'call_stmt') {
      const call = childStmts[0];
      if (call.name === 'difference') {
        const subStmts = this.getChildStmtList(call.child);
        if (subStmts.length >= 2) {
          const baseItems = this.evalLinearExtrudeChildren([subStmts[0]], scope, height, center, twist, slices, sx, sy, depth + 1);
          let baseGeom = mergeBufferGeometriesSimple(baseItems.map((i) => i.geom));
          if (!baseGeom) return [];
          // Oversize cutters slightly along Z to avoid coplanar CSG artifacts
          const cutH = height + 2;
          for (let i = 1; i < subStmts.length; i++) {
            const cutItems = this.evalLinearExtrudeChildren([subStmts[i]], scope, cutH, center, twist, slices, sx, sy, depth + 1);
            const cutGeom = mergeBufferGeometriesSimple(cutItems.map((c) => c.geom));
            if (cutGeom) {
              if (!center) cutGeom.translate(0, 0, -1);
              baseGeom = performCSG(baseGeom, cutGeom, SUBTRACTION);
            }
          }
          return [{ geom: baseGeom, label: '2D-Extrusion (Differenz)' }];
        }
      }
      if (call.name === 'intersection') {
        const subStmts = this.getChildStmtList(call.child);
        if (subStmts.length >= 2) {
          let accGeom = mergeBufferGeometriesSimple(
            this.evalLinearExtrudeChildren([subStmts[0]], scope, height, center, twist, slices, sx, sy, depth + 1).map((i) => i.geom)
          );
          if (!accGeom) return [];
          for (let i = 1; i < subStmts.length; i++) {
            const nextGeom = mergeBufferGeometriesSimple(
              this.evalLinearExtrudeChildren([subStmts[i]], scope, height, center, twist, slices, sx, sy, depth + 1).map((c) => c.geom)
            );
            if (nextGeom) accGeom = performCSG(accGeom, nextGeom, INTERSECTION);
          }
          return [{ geom: accGeom, label: '2D-Extrusion (Schnitt)' }];
        }
      }
    }

    const contours = this.evalStmts2D(childStmts, scope, depth + 1);
    return this.extrudeContours(contours, height, center, twist, slices, sx, sy);
  }

  private extrudeContours(
    contours: Raw2DContour[],
    height: number,
    center: boolean,
    twistDeg: number,
    slices: number,
    scaleX: number,
    scaleY: number
  ): Raw3DItem[] {
    const out: Raw3DItem[] = [];
    for (const c of contours) {
      if (c.outer.length < 3) continue;
      const shape = new THREE.Shape(c.outer);
      for (const hole of c.holes) {
        if (hole.length >= 3) {
          shape.holes.push(new THREE.Path(hole));
        }
      }
      const geom = new THREE.ExtrudeGeometry(shape, {
        depth: height,
        steps: slices,
        bevelEnabled: false,
      });

      // Apply OpenSCAD linear_extrude twist and scale smoothly along Z ∈ [0..height]
      if (Math.abs(twistDeg) > 1e-4 || Math.abs(scaleX - 1) > 1e-4 || Math.abs(scaleY - 1) > 1e-4) {
        const pos = geom.getAttribute('position');
        const twistRad = -THREE.MathUtils.degToRad(twistDeg); // OpenSCAD positive twist is clockwise
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const y = pos.getY(i);
          const z = pos.getZ(i);
          const t = Math.max(0, Math.min(1, z / height));
          const curSx = 1 + (scaleX - 1) * t;
          const curSy = 1 + (scaleY - 1) * t;
          const ang = twistRad * t;
          const cosA = Math.cos(ang);
          const sinA = Math.sin(ang);
          const sxp = x * curSx;
          const syp = y * curSy;
          pos.setXYZ(i, sxp * cosA - syp * sinA, sxp * sinA + syp * cosA, z);
        }
        pos.needsUpdate = true;
        geom.computeVertexNormals();
      }

      if (center) {
        geom.translate(0, 0, -height / 2);
      }
      this.primitiveCount++;
      out.push({ geom: normalizeGeometryForCSG(geom), label: `Extrusion (h=${height.toFixed(1)})` });
    }
    return out;
  }

  private evalStmts2D(stmts: StmtNode[], scope: EvalScope, depth: number): Raw2DContour[] {
    if (depth > 64 || this.stepBudget <= 0) return [];
    const out: Raw2DContour[] = [];
    for (const st of stmts) {
      if (st.kind === 'assign') {
        scope.vars[st.name] = this.evalExpr(st.expr, scope);
        continue;
      }
      const res = this.evalStmt2D(st, scope, depth);
      for (const c of res) out.push(c);
    }
    return out;
  }

  private transformContours2D(contours: Raw2DContour[], fn: (p: THREE.Vector2) => THREE.Vector2): Raw2DContour[] {
    return contours.map((c) => ({
      outer: c.outer.map(fn),
      holes: c.holes.map((h) => h.map(fn)),
    }));
  }

  private evalStmt2D(st: StmtNode, scope: EvalScope, depth: number): Raw2DContour[] {
    if (depth > 64 || --this.stepBudget <= 0) return [];

    if (st.kind === 'block') {
      return this.evalStmts2D(st.stmts, this.createChildScope(scope), depth + 1);
    }
    if (st.kind === 'if') {
      return this.isTruthy(this.evalExpr(st.cond, scope))
        ? this.evalStmt2D(st.thenBranch, scope, depth + 1)
        : st.elseBranch
        ? this.evalStmt2D(st.elseBranch, scope, depth + 1)
        : [];
    }
    if (st.kind === 'for') {
      const out: Raw2DContour[] = [];
      const runLoop = (idx: number, curScope: EvalScope) => {
        if (idx >= st.bindings.length) {
          out.push(...this.evalStmt2D(st.body, curScope, depth + 1));
          return;
        }
        const b = st.bindings[idx];
        for (const val of this.expandIterable(this.evalExpr(b.expr, curScope))) {
          const iterScope = this.createChildScope(curScope);
          iterScope.vars[b.name] = val;
          runLoop(idx + 1, iterScope);
        }
      };
      runLoop(0, scope);
      return out;
    }
    if (st.kind === 'let') {
      const s = this.createChildScope(scope);
      for (const b of st.bindings) s.vars[b.name] = this.evalExpr(b.expr, s);
      return this.evalStmt2D(st.body, s, depth + 1);
    }
    if (st.kind !== 'call_stmt' || st.modifier === '*') return [];

    const args = this.resolveCallArgs(st.args, scope);
    const name = st.name;

    if (name === 'square') {
      const sizeArg = args.named.size ?? args.pos[0] ?? 1;
      const center = this.isTruthy(args.named.center ?? args.pos[1] ?? false);
      let w = 1, h = 1;
      if (Array.isArray(sizeArg)) {
        w = Math.max(0.05, Math.abs(Number(sizeArg[0] ?? 1)));
        h = Math.max(0.05, Math.abs(Number(sizeArg[1] ?? 1)));
      } else {
        w = h = Math.max(0.05, Math.abs(Number(sizeArg) || 1));
      }
      const x0 = center ? -w / 2 : 0;
      const y0 = center ? -h / 2 : 0;
      return [
        {
          outer: [
            new THREE.Vector2(x0, y0),
            new THREE.Vector2(x0 + w, y0),
            new THREE.Vector2(x0 + w, y0 + h),
            new THREE.Vector2(x0, y0 + h),
          ],
          holes: [],
        },
      ];
    }

    if (name === 'circle') {
      let r = 1;
      if (args.named.r !== undefined) r = Number(args.named.r);
      else if (args.named.d !== undefined) r = Number(args.named.d) / 2;
      else if (args.pos[0] !== undefined) r = Number(args.pos[0]);
      r = Math.max(0.05, Math.abs(r || 1));
      const segs = this.getSegments(scope, args.named.$fn !== undefined ? Number(args.named.$fn) : undefined);
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
      }
      return [{ outer: pts, holes: [] }];
    }

    if (name === 'polygon') {
      const ptsRaw = args.named.points ?? args.pos[0];
      const pathsRaw = args.named.paths ?? args.pos[1];
      if (!Array.isArray(ptsRaw) || ptsRaw.length < 3) return [];
      const vecPts = ptsRaw.map((p) =>
        Array.isArray(p) ? new THREE.Vector2(Number(p[0] ?? 0), Number(p[1] ?? 0)) : new THREE.Vector2(0, 0)
      );
      if (Array.isArray(pathsRaw) && pathsRaw.length > 0 && Array.isArray(pathsRaw[0])) {
        const outerIdx = pathsRaw[0] as number[];
        const outer = outerIdx.map((idx) => vecPts[Number(idx)]).filter(Boolean);
        const holes: THREE.Vector2[][] = [];
        for (let k = 1; k < pathsRaw.length; k++) {
          if (Array.isArray(pathsRaw[k])) {
            const hole = (pathsRaw[k] as number[]).map((idx) => vecPts[Number(idx)]).filter(Boolean);
            if (hole.length >= 3) holes.push(hole);
          }
        }
        return outer.length >= 3 ? [{ outer, holes }] : [];
      }
      return [{ outer: vecPts, holes: [] }];
    }

    if (name === 'translate') {
      const v = args.named.v ?? args.pos[0];
      const dx = Array.isArray(v) ? Number(v[0] ?? 0) : 0;
      const dy = Array.isArray(v) ? Number(v[1] ?? 0) : 0;
      const children = this.evalStmts2D(this.getChildStmtList(st.child), scope, depth + 1);
      return this.transformContours2D(children, (p) => new THREE.Vector2(p.x + dx, p.y + dy));
    }

    if (name === 'rotate') {
      const a = args.named.a ?? args.pos[0];
      const deg = Array.isArray(a) ? Number(a[2] ?? 0) : Number(a ?? 0);
      const rad = THREE.MathUtils.degToRad(deg);
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);
      const children = this.evalStmts2D(this.getChildStmtList(st.child), scope, depth + 1);
      return this.transformContours2D(children, (p) => new THREE.Vector2(p.x * cosA - p.y * sinA, p.x * sinA + p.y * cosA));
    }

    if (name === 'scale') {
      const v = args.named.v ?? args.pos[0];
      const sx = Array.isArray(v) ? Number(v[0] ?? 1) : Number(v ?? 1);
      const sy = Array.isArray(v) ? Number(v[1] ?? sx) : sx;
      const children = this.evalStmts2D(this.getChildStmtList(st.child), scope, depth + 1);
      return this.transformContours2D(children, (p) => new THREE.Vector2(p.x * sx, p.y * sy));
    }

    if (name === 'mirror') {
      const v = args.named.v ?? args.pos[0];
      const mx = Array.isArray(v) ? Number(v[0] ?? 0) : 0;
      const my = Array.isArray(v) ? Number(v[1] ?? 0) : 0;
      const len = Math.hypot(mx, my) || 1;
      const nx = mx / len, ny = my / len;
      const children = this.evalStmts2D(this.getChildStmtList(st.child), scope, depth + 1);
      return this.transformContours2D(children, (p) => {
        const dot = p.x * nx + p.y * ny;
        return new THREE.Vector2(p.x - 2 * dot * nx, p.y - 2 * dot * ny);
      });
    }

    if (name === 'offset') {
      // Approximate 2D offset by scaling each contour outward/inward from its centroid
      const r = Number(args.named.r ?? args.named.delta ?? args.pos[0] ?? 0);
      const children = this.evalStmts2D(this.getChildStmtList(st.child), scope, depth + 1);
      if (Math.abs(r) < 1e-4) return children;
      return children.map((c) => {
        const cx = c.outer.reduce((s, p) => s + p.x, 0) / Math.max(1, c.outer.length);
        const cy = c.outer.reduce((s, p) => s + p.y, 0) / Math.max(1, c.outer.length);
        const outer = c.outer.map((p) => {
          const dx = p.x - cx, dy = p.y - cy;
          const d = Math.hypot(dx, dy) || 1;
          return new THREE.Vector2(p.x + (dx / d) * r, p.y + (dy / d) * r);
        });
        return { outer, holes: c.holes };
      });
    }

    if (name === 'hull') {
      const children = this.evalStmts2D(this.getChildStmtList(st.child), scope, depth + 1);
      const allPts: THREE.Vector2[] = [];
      for (const c of children) allPts.push(...c.outer);
      if (allPts.length < 3) return [];
      return [{ outer: convexHull2D(allPts), holes: [] }];
    }

    if (name === 'difference') {
      // Nested 2D difference: attach inner contours as shape holes
      const sub = this.getChildStmtList(st.child);
      if (sub.length === 0) return [];
      const base = this.evalStmt2D(sub[0], scope, depth + 1);
      if (base.length === 0) return [];
      for (let i = 1; i < sub.length; i++) {
        const cuts = this.evalStmt2D(sub[i], scope, depth + 1);
        for (const cut of cuts) {
          if (cut.outer.length >= 3) base[0].holes.push(cut.outer);
        }
      }
      return base;
    }

    if (name === 'union') {
      return this.evalStmts2D(this.getChildStmtList(st.child), scope, depth + 1);
    }

    if (name === 'children') {
      if (!scope.callerChildren || !scope.callerScope) return [];
      return this.evalStmts2D(scope.callerChildren, scope.callerScope, depth + 1);
    }

    // User-defined 2D module
    const userMod = this.getMod(scope, name);
    if (userMod) {
      const childList = this.getChildStmtList(st.child);
      const modParent = userMod.defScope || scope;
      const modScope = this.createChildScope(modParent, childList, scope);
      for (const sv of ['$fn', '$fa', '$fs', '$t']) {
        const v = this.getVar(scope, sv);
        if (v !== undefined) modScope.vars[sv] = v;
      }
      userMod.params.forEach((p, idx) => {
        if (p.name in args.named) modScope.vars[p.name] = args.named[p.name];
        else if (idx < args.pos.length) modScope.vars[p.name] = args.pos[idx];
        else if (p.defaultExpr) modScope.vars[p.name] = this.evalExpr(p.defaultExpr, modScope);
        else modScope.vars[p.name] = undefined;
      });
      return this.evalStmts2D(userMod.body, modScope, depth + 1);
    }

    return [];
  }
}

/**
 * Evaluates arbitrary OpenSCAD source code into real, accurately positioned,
 * CSG-evaluated Three.js BufferGeometries in OpenSCAD Z-up millimeter space.
 * Supports multi-file `include <...>` and `use <...>` via `scadLibraries`.
 */
export function evaluateOpenScadToGeometries(
  scadCode: string,
  paramOverrides: Record<string, number> = {},
  scadLibraries: Record<string, string> = {}
): ScadEvaluationOutput {
  const tokens = tokenizeScad(scadCode);
  const parser = new ScadParser(tokens);
  const ast = parser.parseProgram();
  const evaluator = new ScadEvaluator(paramOverrides, scadLibraries, scadCode);
  return evaluator.evaluateProgram(ast);
}
