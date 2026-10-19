// The import rules the audit's tool layer reports against. Layers follow
// docs/ARCHITECTURE.md; a violation here is an input for an investigator, not a gate.
const layer = (name, from, to) => ({ name, severity: 'error', from: { path: from }, to: { path: to } });

module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true, dependencyTypesNot: ['type-only'] } },
    { name: 'no-orphans', severity: 'warn', from: { orphan: true, pathNot: ['\\.d\\.ts$', '(^|/)\\.', '\\.config\\.', '^app/', '^scripts/', '^tools/'] }, to: {} },
    { name: 'not-to-unresolvable', severity: 'error', from: {}, to: { couldNotResolve: true } },
    { name: 'no-undeclared-dependency', severity: 'error', from: {}, to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] } },
    { name: 'production-not-to-dev-dependency', severity: 'error', from: { path: '^(app|components|context|lib|server|shared)/' }, to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only'] } },
    layer('production-not-to-tests', '^(app|components|context|lib|server|shared|scripts)/', '^tests/'),
    layer('game-is-pure', '^lib/game/', '^(app|components|context|server)/|^lib/(device|socket)'),
    layer('shared-is-a-leaf', '^shared/', '^(app|components|context|lib|server)/'),
    layer('client-not-to-server', '^(app|components|context|lib)/', '^server/'),
    layer('server-not-to-client', '^server/', '^(app|components|context)/'),
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)node_modules/|^tests/e2e/.*\\.html$' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default'] },
  },
};
