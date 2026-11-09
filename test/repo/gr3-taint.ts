// GR-3 static scan (SIG-42 review 9, C2): a taint check over the TypeScript syntax tree, in place
// of the regex scan, which missed nested destructuring, computed keys, and a token
// `withoutSensitive()` call placed beside an ungated read.
//
// Every read of an account's transactions must come from a value the gate returned. The check
// follows: variables and their initialisers; property and element access, with literal or
// constant keys (one level of object-literal properties is tracked, so `ctx.feed` is gated only
// when `feed` was given a gated value); array methods (`map`, `flatMap`, `filter`, ...) and
// their callback parameters; for-of; destructuring, nested to any depth; spreads; and the
// parameters of a local function, gated when every direct call passes a gated argument, or when
// every object written with the parameter's declared type gates that property. A read whose
// source can't be shown gated counts as ungated: an unknown fails, never passes.
import ts from "typescript";

export type Read = { line: number; text: string; gated: boolean };

/** Gated entirely; gated on some properties only; gated on all but some; or not gated. */
type Taint =
  | { kind: "full" }
  | { kind: "only"; props: ReadonlySet<string> }
  | { kind: "except"; props: ReadonlySet<string> }
  | null;
const FULL: Taint = { kind: "full" };
const isFull = (t: Taint) => t?.kind === "full";
const ARRAY_METHODS = new Set([
  "map",
  "flatMap",
  "filter",
  "slice",
  "find",
  "findLast",
  "forEach",
  "some",
  "every",
  "sort",
  "toSorted",
  "concat",
  "at",
]);
const KEY = "transactions";

function member(t: Taint, prop: string | null): Taint {
  if (!t) return null;
  if (t.kind === "full") return FULL;
  if (prop === null) return null;
  if (t.kind === "only") return t.props.has(prop) ? FULL : null;
  return t.props.has(prop) ? null : FULL;
}
function meet(a: Taint, b: Taint): Taint {
  if (!a || !b) return null;
  if (a.kind === "full") return b;
  if (b.kind === "full") return a;
  if (a.kind === "only" && b.kind === "only")
    return { kind: "only", props: new Set([...a.props].filter((k) => b.props.has(k))) };
  if (a.kind === "except" && b.kind === "except")
    return { kind: "except", props: new Set([...a.props, ...b.props]) };
  const only = (a.kind === "only" ? a : b) as { props: ReadonlySet<string> };
  const except = (a.kind === "except" ? a : b) as { props: ReadonlySet<string> };
  return { kind: "only", props: new Set([...only.props].filter((k) => !except.props.has(k))) };
}
const same = (a: Taint, b: Taint) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
const norm = (t: Taint) => (t && t.kind !== "full" ? { k: t.kind, p: [...t.props].sort() } : t);

export function scanTransactionsReads(source: string, file = "x.ts"): Read[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const visit = (n: ts.Node, f: (n: ts.Node) => void) => {
    f(n);
    n.forEachChild((c) => visit(c, f));
  };
  const decls = new Map<string, ts.Node[]>();
  const constStrings = new Map<string, string>();
  visit(sf, (n) => {
    const add = (id: ts.Identifier) => decls.set(id.text, [...(decls.get(id.text) ?? []), n]);
    if (
      (ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n)) &&
      ts.isIdentifier(n.name)
    )
      add(n.name);
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      ts.isStringLiteralLike(n.initializer)
    )
      constStrings.set(n.name.text, n.initializer.text);
  });
  const taint = new Map<ts.Node, Taint>(); // a declaration, parameter, binding element or pattern

  const constKey = (e: ts.Expression): string | null => {
    if (ts.isStringLiteralLike(e)) return e.text;
    if (ts.isIdentifier(e)) return constStrings.get(e.text) ?? null;
    if (ts.isParenthesizedExpression(e)) return constKey(e.expression);
    return null;
  };
  const nameKey = (k: ts.PropertyName | undefined): string | null => {
    if (!k) return null;
    if (ts.isComputedPropertyName(k)) return constKey(k.expression);
    if (ts.isIdentifier(k) || ts.isStringLiteralLike(k) || ts.isNumericLiteral(k)) return k.text;
    return null;
  };
  /** The scope a declaration is visible in: its block, or its function for a parameter. */
  const scopeOf = (d: ts.Node): ts.Node => {
    let n: ts.Node = d;
    while (ts.isBindingElement(n) || ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n))
      n = n.parent;
    if (ts.isParameter(n)) return n.parent;
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent)
      if (
        ts.isBlock(p) ||
        ts.isSourceFile(p) ||
        ts.isForOfStatement(p) ||
        ts.isForStatement(p) ||
        ts.isForInStatement(p) ||
        ts.isCaseBlock(p) ||
        ts.isFunctionLike(p)
      )
        return p;
    return sf;
  };
  /** The innermost declaration of an identifier's name whose scope contains it. */
  const byName = (id: ts.Identifier): Taint => {
    const candidates = (decls.get(id.text) ?? [])
      .map((d) => ({ d, s: scopeOf(d) }))
      .filter(({ s }) => s.pos <= id.pos && id.end <= s.end)
      .sort((a, b) => a.s.end - a.s.pos - (b.s.end - b.s.pos));
    const d = candidates[0]?.d;
    return d ? (taint.get(d) ?? null) : null;
  };

  function T(e: ts.Expression | undefined): Taint {
    if (!e) return null;
    if (
      ts.isParenthesizedExpression(e) ||
      ts.isAsExpression(e) ||
      ts.isNonNullExpression(e) ||
      ts.isSatisfiesExpression(e) ||
      ts.isTypeAssertionExpression(e)
    )
      return T(e.expression);
    if (ts.isIdentifier(e)) return byName(e);
    if (ts.isPropertyAccessExpression(e)) return member(T(e.expression), e.name.text);
    if (ts.isElementAccessExpression(e)) {
      const k = constKey(e.argumentExpression);
      const base = T(e.expression);
      return k !== null ? member(base, k) : isFull(base) ? FULL : null;
    }
    if (ts.isCallExpression(e)) {
      const c = e.expression;
      if (ts.isIdentifier(c) && c.text === "withoutSensitive") return FULL;
      if (ts.isPropertyAccessExpression(c) && ARRAY_METHODS.has(c.name.text))
        return isFull(T(c.expression)) ? FULL : null;
      return null;
    }
    if (ts.isConditionalExpression(e)) return meet(T(e.whenTrue), T(e.whenFalse));
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
      return meet(T(e.left), T(e.right));
    if (ts.isObjectLiteralExpression(e)) return objectTaint(e);
    if (ts.isArrayLiteralExpression(e))
      return e.elements.length > 0 &&
        e.elements.every((x) => isFull(T(ts.isSpreadElement(x) ? x.expression : x)))
        ? FULL
        : null;
    return null;
  }
  function objectTaint(o: ts.ObjectLiteralExpression): Taint {
    let base: Taint = { kind: "only", props: new Set() };
    for (const p of o.properties) {
      if (ts.isSpreadAssignment(p)) {
        const t = T(p.expression);
        // A later spread can only add what it gates; anything else it may overwrite is unknown.
        base = !t ? base : t.kind === "full" ? FULL : union(base, t);
        continue;
      }
      const k = nameKey(p.name);
      const value = ts.isPropertyAssignment(p)
        ? T(p.initializer)
        : ts.isShorthandPropertyAssignment(p)
          ? byName(p.name)
          : null;
      if (k === null) return null;
      base = isFull(value) ? withProp(base, k) : withoutProp(base, k);
    }
    return base;
  }
  function union(a: Taint, b: Taint): Taint {
    if (!a) return b;
    if (!b) return a;
    if (a.kind === "full" || b.kind === "full") return FULL;
    if (a.kind === "only" && b.kind === "only")
      return { kind: "only", props: new Set([...a.props, ...b.props]) };
    if (a.kind === "except" && b.kind === "except")
      return { kind: "except", props: new Set([...a.props].filter((k) => b.props.has(k))) };
    const only = (a.kind === "only" ? a : b) as { props: ReadonlySet<string> };
    const except = (a.kind === "except" ? a : b) as { props: ReadonlySet<string> };
    return { kind: "except", props: new Set([...except.props].filter((k) => !only.props.has(k))) };
  }
  const withProp = (t: Taint, k: string): Taint =>
    !t || t.kind === "only"
      ? { kind: "only", props: new Set([...(t?.props ?? []), k]) }
      : t.kind === "full"
        ? FULL
        : { kind: "except", props: new Set([...t.props].filter((x) => x !== k)) };
  const withoutProp = (t: Taint, k: string): Taint =>
    !t
      ? null
      : t.kind === "only"
        ? { kind: "only", props: new Set([...t.props].filter((x) => x !== k)) }
        : { kind: "except", props: new Set([...(t.kind === "except" ? t.props : []), k]) };

  /** Taint a binding pattern, every name it binds and every pattern nested in it. */
  function bind(name: ts.BindingName, t: Taint) {
    taint.set(name, t);
    if (ts.isIdentifier(name)) return;
    for (const el of name.elements) {
      if (ts.isOmittedExpression(el)) continue;
      const sub: Taint = ts.isObjectBindingPattern(name)
        ? el.dotDotDotToken
          ? t
          : member(
              t,
              el.propertyName
                ? nameKey(el.propertyName)
                : ts.isIdentifier(el.name)
                  ? el.name.text
                  : null,
            )
        : isFull(t)
          ? FULL
          : null;
      taint.set(el, sub);
      bind(el.name, sub);
    }
  }
  const setParam = (p: ts.ParameterDeclaration, t: Taint) => {
    taint.set(p, t);
    bind(p.name, t);
  };

  for (let pass = 0; pass < 10; pass++) {
    const before = new Map(taint);
    // Declared types gated by every object literal written with them.
    const typeTaint = new Map<string, Taint>();
    visit(sf, (n) => {
      if (
        ts.isVariableDeclaration(n) &&
        n.type &&
        ts.isTypeReferenceNode(n.type) &&
        ts.isIdentifier(n.type.typeName) &&
        n.initializer
      ) {
        const name = n.type.typeName.text;
        const t = T(n.initializer);
        typeTaint.set(name, typeTaint.has(name) ? meet(typeTaint.get(name) ?? null, t) : t);
      }
    });
    visit(sf, (n) => {
      if (ts.isVariableDeclaration(n)) {
        const t = ts.isForOfStatement(n.parent.parent)
          ? isFull(T(n.parent.parent.expression))
            ? FULL
            : null
          : T(n.initializer);
        taint.set(n, t);
        bind(n.name, t);
      }
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        ARRAY_METHODS.has(n.expression.name.text)
      ) {
        const cb = n.arguments[0];
        const p =
          cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))
            ? cb.parameters[0]
            : undefined;
        if (p) setParam(p, isFull(T(n.expression.expression)) ? FULL : null);
      }
      const fn =
        ts.isFunctionDeclaration(n) && n.name
          ? { name: n.name.text, params: n.parameters }
          : ts.isVariableDeclaration(n) &&
              ts.isIdentifier(n.name) &&
              n.initializer &&
              (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
            ? { name: n.name.text, params: n.initializer.parameters }
            : null;
      if (fn) {
        const calls: ts.CallExpression[] = [];
        visit(sf, (c) => {
          if (
            ts.isCallExpression(c) &&
            ts.isIdentifier(c.expression) &&
            c.expression.text === fn.name
          )
            calls.push(c);
        });
        fn.params.forEach((p, i) => {
          const byCalls =
            calls.length > 0
              ? calls.reduce<Taint>((t, c) => meet(t, T(c.arguments[i])), FULL)
              : null;
          const typed =
            p.type && ts.isTypeReferenceNode(p.type) && ts.isIdentifier(p.type.typeName)
              ? (typeTaint.get(p.type.typeName.text) ?? null)
              : null;
          setParam(p, union(byCalls, typed));
        });
      }
    });
    if ([...taint].every(([k, v]) => before.has(k) && same(before.get(k) ?? null, v))) break;
  }

  const reads: Read[] = [];
  const at = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const inType = (n: ts.Node) => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent)
      if (ts.isTypeNode(p) || ts.isTypeAliasDeclaration(p) || ts.isInterfaceDeclaration(p))
        return true;
    return false;
  };
  visit(sf, (n) => {
    if (inType(n)) return;
    if (ts.isPropertyAccessExpression(n) && n.name.text === KEY)
      reads.push({ line: at(n), text: n.getText(sf), gated: isFull(T(n.expression)) });
    if (ts.isElementAccessExpression(n) && constKey(n.argumentExpression) === KEY)
      reads.push({ line: at(n), text: n.getText(sf), gated: isFull(T(n.expression)) });
    if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent)) {
      const k = n.propertyName
        ? nameKey(n.propertyName)
        : ts.isIdentifier(n.name)
          ? n.name.text
          : null;
      if (k === KEY)
        reads.push({ line: at(n), text: n.getText(sf), gated: isFull(taint.get(n) ?? null) });
    }
  });
  return reads;
}
