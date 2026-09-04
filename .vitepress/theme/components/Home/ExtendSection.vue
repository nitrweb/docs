<script setup lang="ts">
import CodeWindow from './CodeWindow.vue'

const k = (t: string) => `<span class="nitr-t-key">${t}</span>`
const s = (t: string) => `<span class="nitr-t-str">${t}</span>`
const n = (t: string) => `<span class="nitr-t-num">${t}</span>`
const c = (t: string) => `<span class="nitr-t-comment">${t}</span>`
const f = (t: string) => `<span class="nitr-t-flag">${t}</span>`
const fn = (t: string) => `<span class="nitr-t-cmd">${t}</span>`

const CODE = `${k('use')} nitr::{Builtins, Server};

${f('#[tokio::main]')}
${k('async fn')} ${fn('main')}() -&gt; nitr::Result {
    Server::builder()
        .listen(([${n('127')}, ${n('0')}, ${n('0')}, ${n('1')}], ${n('3000')}).into())
        .handler_script(${s('"app.lua"')})
        .builtins(Builtins::JSON | Builtins::HTTP)
        ${c('// Your Rust, mounted as nitr.ext.greet')}
        .module(${s('"greet"')}, |lua| {
            ${k('let')} t = lua.create_table()?;
            t.set(${s('"hello"')}, lua.create_function(
                |_, name: String| Ok(${fn('format!')}(${s('"Hello, {name}!"')})))?)?;
            Ok(t)
        })
        .build().${k('await')}?
        .serve().${k('await')}
}`
</script>

<template>
  <section id="extend" class="nitr-section nitr-alt">
    <div class="nitr-container nitr-two-col">
      <div class="nitr-two-col-code" data-reveal style="--i: 1">
        <CodeWindow name="main.rs" lang="rust" :code="CODE" />
      </div>

      <div data-reveal>
        <p class="nitr-kicker">Extensible</p>
        <h2>Bring your own Rust modules.</h2>
        <p class="nitr-sub">
          Nitr is also a library crate. Mount your own Rust modules into every Lua
          state at <code>nitr.ext.*</code> — one level below the standard library, so
          no future builtin can ever collide with them.
        </p>
        <ul class="nitr-check-list">
          <li>Rust owns what happens inside: shared state, I/O, native speed.</li>
          <li>Lua only composes it, still under its memory and time budget.</li>
          <li>Third-party extension crates need no fork.</li>
        </ul>
        <p class="nitr-callout">
          <svg class="nitr-callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 8h.01M11 12h1v4h1M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" />
          </svg>
          <span>
            Two modules sharing a name fail at build time, and a module can never
            shadow a builtin — <code>nitr.ext.*</code> is reserved for you.
          </span>
        </p>
        <a class="nitr-link-arrow" href="/v1/library/extension-modules">
          How extension modules work →
        </a>
      </div>
    </div>
  </section>
</template>
