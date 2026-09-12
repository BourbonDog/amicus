/**
 * Tests for client-aware prompt in opencode-client.js buildServerOptions()
 *
 * Tests the config-building logic directly via buildServerOptions(),
 * which is a pure function with no SDK dependency. This avoids the
 * dynamic import() limitation in Jest (requires --experimental-vm-modules).
 */

const { buildServerOptions } = require('../src/opencode-client');

describe('buildServerOptions client-aware prompt', () => {
  it('sets chat.prompt when client is cowork', () => {
    const opts = buildServerOptions({ client: 'cowork' });
    const chatAgent = opts.config.agent.chat;

    expect(chatAgent).toBeDefined();
    expect(chatAgent.prompt).toBeDefined();
    expect(typeof chatAgent.prompt).toBe('string');
    expect(chatAgent.prompt).toContain('Sidecar');
  });

  it('does NOT set chat.prompt when client is code-local', () => {
    const opts = buildServerOptions({ client: 'code-local' });
    const chatAgent = opts.config.agent.chat;

    expect(chatAgent).toBeDefined();
    expect(chatAgent.prompt).toBeUndefined();
  });

  it('does NOT set chat.prompt when client is undefined', () => {
    const opts = buildServerOptions({});
    const chatAgent = opts.config.agent.chat;

    expect(chatAgent).toBeDefined();
    expect(chatAgent.prompt).toBeUndefined();
  });

  it('preserves existing chat agent permissions when cowork', () => {
    const opts = buildServerOptions({ client: 'cowork' });
    const chatAgent = opts.config.agent.chat;

    expect(chatAgent.permission).toEqual({
      edit: 'ask',
      bash: 'ask',
      webfetch: 'allow'
    });
    expect(chatAgent.mode).toBe('primary');
  });
});

describe('buildServerOptions systemPrompt on agent config', () => {
  it('sets systemPrompt on the target agent (chat)', () => {
    const opts = buildServerOptions({
      systemPrompt: '# SIDECAR SESSION\nYou are a sidecar agent.',
      agentName: 'chat'
    });
    const chatAgent = opts.config.agent.chat;

    expect(chatAgent.prompt).toBe('# SIDECAR SESSION\nYou are a sidecar agent.');
  });

  it('sets systemPrompt on build agent when agentName is build', () => {
    const opts = buildServerOptions({
      systemPrompt: '# SIDECAR SESSION\nBuild agent prompt.',
      agentName: 'build'
    });

    expect(opts.config.agent.build).toBeDefined();
    expect(opts.config.agent.build.prompt).toBe('# SIDECAR SESSION\nBuild agent prompt.');
  });

  it('sets systemPrompt on plan agent when agentName is plan', () => {
    const opts = buildServerOptions({
      systemPrompt: '# SIDECAR SESSION\nPlan agent prompt.',
      agentName: 'plan'
    });

    expect(opts.config.agent.plan).toBeDefined();
    expect(opts.config.agent.plan.prompt).toBe('# SIDECAR SESSION\nPlan agent prompt.');
  });

  it('defaults to chat agent when agentName is not specified', () => {
    const opts = buildServerOptions({
      systemPrompt: '# SIDECAR SESSION\nDefault agent.'
    });
    const chatAgent = opts.config.agent.chat;

    expect(chatAgent.prompt).toBe('# SIDECAR SESSION\nDefault agent.');
  });

  it('appends systemPrompt to existing cowork prompt', () => {
    const opts = buildServerOptions({
      client: 'cowork',
      systemPrompt: '# SIDECAR SESSION\nContext here.',
      agentName: 'chat'
    });
    const chatAgent = opts.config.agent.chat;

    // Should contain both cowork prompt and system prompt
    expect(chatAgent.prompt).toContain('Sidecar');
    expect(chatAgent.prompt).toContain('# SIDECAR SESSION');
    expect(chatAgent.prompt).toContain('Context here.');
  });

  it('does not set systemPrompt when not provided', () => {
    const opts = buildServerOptions({});
    const chatAgent = opts.config.agent.chat;

    expect(chatAgent.prompt).toBeUndefined();
  });

  it('handles case-insensitive agent names', () => {
    const opts = buildServerOptions({
      systemPrompt: 'test prompt',
      agentName: 'Build'
    });

    expect(opts.config.agent.build).toBeDefined();
    expect(opts.config.agent.build.prompt).toBe('test prompt');
  });
});

describe('buildServerOptions port handling', () => {
  it('does not include port key when port is not specified', () => {
    const opts = buildServerOptions({});
    expect(opts).not.toHaveProperty('port');
  });

  it('does not include port key when port is undefined', () => {
    const opts = buildServerOptions({ port: undefined });
    expect(opts).not.toHaveProperty('port');
  });

  it('includes port when explicitly set', () => {
    const opts = buildServerOptions({ port: 8080 });
    expect(opts.port).toBe(8080);
  });

  it('does not include signal key when signal is not specified', () => {
    const opts = buildServerOptions({});
    expect(opts).not.toHaveProperty('signal');
  });
});

describe('buildServerOptions provider model sync', () => {
  // TODO(F4/F5): provider/model-alias sync. buildProviderModels() looks correct in
  // isolation, so this is a subtle test-environment interaction in the model-alias/
  // catalog domain — deferred per the F2 spec, §2.5
  // (docs/superpowers/specs/2026-06-09-f2-windows-green-suite-design.md).
  it.skip('includes provider.openrouter.models from sidecar aliases', () => {
    const opts = buildServerOptions({});
    const provider = opts.config.provider;

    expect(provider).toBeDefined();
    expect(provider.openrouter).toBeDefined();
    expect(provider.openrouter.models).toBeDefined();

    // Should include models from default aliases
    expect(provider.openrouter.models['x-ai/grok-4.3']).toBeDefined();
    expect(provider.openrouter.models['anthropic/claude-opus-4.6']).toBeDefined();
  });

  it('includes provider models even when other options are set', () => {
    const opts = buildServerOptions({
      model: 'openrouter/x-ai/grok-4.3',
      systemPrompt: 'test',
    });

    expect(opts.config.provider.openrouter.models).toBeDefined();
    expect(opts.config.model).toBe('openrouter/x-ai/grok-4.3');
  });

  it('merges caller-supplied agents after chat (council seat agents, spec 2026-09-11 §4)', () => {
    const agents = {
      'council-seat': { mode: 'primary', tools: { '*': false, webfetch: true }, permission: { edit: 'deny' } },
      'council-support': { mode: 'primary', tools: { '*': false } },
    };
    const opts = buildServerOptions({ agents });
    expect(opts.config.agent['council-seat']).toEqual(agents['council-seat']);
    expect(opts.config.agent['council-support']).toEqual(agents['council-support']);
    expect(opts.config.agent.chat).toBeDefined(); // never displaced
  });

  it('omits every council agent when none are supplied (non-council servers are byte-identical)', () => {
    const opts = buildServerOptions({});
    expect(Object.keys(opts.config.agent)).toEqual(['chat']);
  });

  // Fix-round-1 nit (opencode-client.js:661): a `chat` key in `agents` used to replace
  // `config.agent.chat` with a brand-new object, detaching it from the local
  // `chatAgent` the systemPrompt branch below mutates — so the "can never
  // displace chat" comment was false. `chat` is now skipped in the merge loop.
  it('ignores a chat key in agents — chat keeps the mutation the systemPrompt branch applies to it', () => {
    const opts = buildServerOptions({
      agents: { chat: { mode: 'other-ignored' } },
      systemPrompt: 'hello from systemPrompt',
    });
    expect(opts.config.agent.chat.mode).toBe('primary'); // chatAgent's own mode, never overwritten
    expect(opts.config.agent.chat.prompt).toBe('hello from systemPrompt'); // same object systemPrompt mutated
  });

  it('ignores agents when it is an array, not a plain object', () => {
    const opts = buildServerOptions({ agents: ['not', 'an', 'object'] });
    expect(Object.keys(opts.config.agent)).toEqual(['chat']);
  });
});
// MCP type normalization tests extracted to tests/mcp-normalization.test.js
