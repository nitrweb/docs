# Templates

`nitr.template` renders [minijinja](https://docs.rs/minijinja/) templates
— Jinja2 syntax, implemented in Rust.

## Enabling it

```toml
[templating]
dir = "templates"

[std]
features = ["json", "http", "log", "template"]   # ← "template"
```

Without `dir` the builtin is unavailable: there is no default location
to guess.

## Rendering

```lua
app:get("/hello/:name", function(req)
    return nitr.html(nitr.template:render("hello.j2", {
        name = req.params.name,
        app  = nitr.cfg.app_name,
    }))
end)
```

::: v-pre

```html
{# templates/hello.j2 #}
<!doctype html>
<h1>Hello, {{ name }}!</h1>
<p>Served by {{ app }}.</p>
```

:::

`render` returns a **string**. Wrap it in `nitr.html(...)` to get the
`Content-Type` right — or build the response by hand if you need
something else:

```lua
return {
    headers = { ["Content-Type"] = "application/xml" },
    body    = nitr.template:render("sitemap.j2", { urls = urls }),
}
```

The name is relative to `[templating] dir`, subdirectories included:

```lua
nitr.template:render("emails/welcome.j2", { user = user })
```

> [!WARNING] `render` yields — call it from a handler
>
> Loading a template reads a file and rendering is CPU work, so both run
> off the async worker. That makes `render` **asynchronous**, like the
> argon2 password calls: it works in a handler or middleware, and fails
> with an explanatory error at the top level of a handler script, which
> runs outside the async executor.

## Template syntax

Standard Jinja2. The essentials:

::: v-pre

```html
{{ variable }} {# interpolation, HTML-escaped #} {{ user.name }} {# nested
access #} {{ items | length }} {# filters #} {% if user %}Hi {{ user.name
}}{% else %}Hi stranger{% endif %} {% for item in items %}
<li>{{ loop.index }}. {{ item.title }}</li>
{% else %}
<li>Nothing here yet.</li>
{% endfor %} {# a comment #}
```

:::

### Inheritance

```html
{# templates/base.j2 #}
<!doctype html>
<html>
  <head>
    <title>{% block title %}My App{% endblock %}</title>
  </head>
  <body>
    <main>{% block content %}{% endblock %}</main>
  </body>
</html>
```

::: v-pre

```html
{# templates/articles/show.j2 #} {% extends "base.j2" %} {% block title
%}{{ article.title }}{% endblock %} {% block content %}
<article>
  <h1>{{ article.title }}</h1>
  {{ article.body }}
</article>
{% endblock %}
```

:::

### Includes and macros

::: v-pre

```html
{% include "partials/header.j2" %} {% macro field(name, label, value) %}
<label
  >{{ label }}
  <input name="{{ name }}" value="{{ value }}" />
</label>
{% endmacro %} {{ field("email", "Email", user.email) }}
```

:::

### Useful filters

::: v-pre

```html
{{ items | length }}
<!-- element / character count -->
{{ name | default("stranger") }}
<!-- fallback for a missing value -->
{{ name | title }}
<!-- also: upper, lower -->
{{ tags | join(", ") }}
<!-- array to string -->
{{ text | trim }}
<!-- strip surrounding whitespace -->
{{ raw | e }}
<!-- explicit escape (also: escape) -->
{{ trusted_html | safe }}
<!-- opt OUT of escaping — see below -->
{{ data | tojson }}
<!-- embed a value as JSON -->
```

:::

## Escaping — read this one

Values are **HTML-escaped by default**, which is what keeps user content
from becoming script:

::: v-pre

```html
{{ user.bio }}          {# <script> becomes &lt;script&gt; #}
```

:::

The `safe` filter **disables that protection**:

::: v-pre

```html
{{ user.bio | safe }}
<!-- ❌ XSS if user.bio came from a user -->
```

:::

> [!DANGER] Use `safe` only for markup you generated
>
> A rendered Markdown document you sanitised, yes. A raw field from a
> form, or a database row that originated in one, never.

### The one way escaping turns off by itself

Escaping follows the **template's name**. Everything escapes, except a
name whose extension — after stripping a trailing `.j2`, `.jinja` or
`.jinja2` — is one of `.txt`, `.text`, `.md`, `.csv`, `.json`, `.yaml`,
`.yml` or `.toml`. Those render verbatim, because HTML-escaping a CSV
column or a JSON string is not an improvement.

| Template name    | Auto-escaping |
| ---------------- | ------------- |
| `page.j2`        | on            |
| `page.html.j2`   | on            |
| `emails/body.j2` | on            |
| `mail.txt.j2`    | **off**       |
| `export.csv`     | **off**       |
| `payload.json`   | **off**       |

So a template that emits HTML must not be named `.txt.j2` for the sake
of an editor's syntax highlighting — and a template rendering into an
email body, a CSV or a JSON document should be, so that quoting is not
mangled. Escape a value explicitly with `| e` where a plain-text
template genuinely needs it.

## Passing data

Only plain data crosses into a template: tables, strings, numbers,
booleans, and nested combinations.

```lua
app:get("/articles", function(req)
    return nitr.html(nitr.template:render("articles/index.j2", {
        articles = nitr.db:query("SELECT id, title, created_at FROM articles ORDER BY id DESC"),
        user     = req.user,
        year     = tonumber(nitr.time.format(nitr.time.now(), "%Y")),
    }))
end)
```

> [!TIP] Format dates in Lua, not in the template
>
> ```lua
> for _, a in ipairs(articles) do
>     a.date = nitr.time.format(a.created_at, "%d %b %Y")
> end
> ```
>
> Templates are for structure. Doing the formatting in Lua keeps it
> testable and keeps `nitr.time` in one place.

## A layout for a real page

```lua
app:get("/articles/:id", function(req)
    local article = nitr.db:query_row(
        "SELECT * FROM articles WHERE id = ?", { req.params.id }
    )
    if not article then
        return nitr.error(404, { code = "NOT_FOUND" })
    end

    article.date = nitr.time.format(article.created_at, "%d %b %Y")

    local etag = nitr.etag(tostring(article.updated_at))
    if req:fresh(etag) then
        return nitr.status(304)
    end

    local resp = nitr.html(nitr.template:render("articles/show.j2", {
        article = article,
        csrf    = nitr.csrf.token(req),
    }))
    resp.headers = resp.headers or {}
    resp.headers["ETag"] = etag
    return resp
end)
```

## Development

In `--dev`, saving a template rebuilds the Lua pool, so a refresh shows
the change. In production, templates are loaded once — a change needs a
[reload](./deployment/#zero-downtime-reload) (`nitr reload` or
`SIGHUP`).

## Errors

A missing template, a syntax error or a failed render raises an error
with `kind = "nitr"`, carrying the template name and line. In
development the response shows it; in production it reaches
[`on_error`](./errors) and the structured log.

Validate templates before shipping — `nitr check` loads the application,
and a `nitr test` that renders each page is the reliable way to catch a
typo in a rarely-visited branch.
