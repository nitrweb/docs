# Templates

`nitr.template` renders [minijinja](https://docs.rs/minijinja/)
templates, which use Jinja2 syntax.

## Enabling it

```toml
[templating]
dir = "templates"

[std]
features = ["json", "http", "log", "template"]
```

Without `[templating] dir`, `nitr.template` is unavailable. There is no
default directory.

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

`render` returns a string. Wrap it in `nitr.html(...)`, or build the
response yourself for another content type:

```lua
return {
    headers = { ["Content-Type"] = "application/xml" },
    body    = nitr.template:render("sitemap.j2", { urls = urls }),
}
```

Names are relative to `[templating] dir` and may include
subdirectories: `nitr.template:render("emails/welcome.j2", data)`.

> [!WARNING] Call `render` from a handler or middleware
>
> Rendering runs in the background, so `render` must be called while a
> request is being handled. At the top level of the handler script it
> raises an error.

## Template syntax

Standard Jinja2:

::: v-pre

```jinja
{{ user.name }}                  {# a value, HTML-escaped #}
{{ items | length }}             {# a filter #}

{% if user %}Hi {{ user.name }}{% else %}Hi stranger{% endif %}

{% for item in items %}
  <li>{{ loop.index }}. {{ item.title }}</li>
{% else %}
  <li>Nothing here yet.</li>
{% endfor %}
```

:::

### Inheritance

::: v-pre

```jinja
{# templates/base.j2 #}
<!doctype html>
<html>
  <head><title>{% block title %}My App{% endblock %}</title></head>
  <body><main>{% block content %}{% endblock %}</main></body>
</html>
```

```jinja
{# templates/articles/show.j2 #}
{% extends "base.j2" %}
{% block title %}{{ article.title }}{% endblock %}
{% block content %}
  <article>
    <h1>{{ article.title }}</h1>
    {{ article.body }}
  </article>
{% endblock %}
```

:::

### Includes and macros

::: v-pre

```jinja
{% include "partials/header.j2" %}

{% macro field(name, label, value) %}
  <label>{{ label }} <input name="{{ name }}" value="{{ value }}" /></label>
{% endmacro %}

{{ field("email", "Email", user.email) }}
```

:::

### Useful filters

::: v-pre

| Filter                          | Does                               |
| ------------------------------- | ---------------------------------- |
| `{{ items \| length }}`         | Number of items or characters      |
| `{{ name \| default("anon") }}` | Fallback for a missing value       |
| `{{ name \| title }}`           | Title case (also `upper`, `lower`) |
| `{{ tags \| join(", ") }}`      | Join a list into a string          |
| `{{ text \| trim }}`            | Strip surrounding whitespace       |
| `{{ raw \| e }}`                | Escape explicitly (also `escape`)  |
| `{{ html \| safe }}`            | Turn escaping **off**; see below   |

:::

There is no `tojson` filter. To embed JSON, encode it in Lua with
`nitr.json:encode(value)` and pass the string.

## Escaping {#escaping-read-this-one}

Values are HTML-escaped by default, so user content cannot become
script. The `safe` filter turns that off:

::: v-pre

```jinja
{{ user.bio }}          {# <script> becomes &lt;script&gt; #}
{{ user.bio | safe }}   {# XSS if user.bio came from a user #}
```

:::

> [!DANGER] Use `safe` only for markup you generated
>
> Sanitised Markdown output, yes. A form field, or a database value
> that came from one, never.

### When escaping is off

Escaping depends on the template's name. It is off only when the name,
after removing a trailing `.j2`, `.jinja` or `.jinja2`, ends in `.txt`,
`.text`, `.md`, `.csv`, `.json`, `.yaml`, `.yml` or `.toml`:

| Template name  | Escaping |
| -------------- | -------- |
| `page.j2`      | on       |
| `page.html.j2` | on       |
| `mail.txt.j2`  | **off**  |
| `export.csv`   | **off**  |
| `payload.json` | **off**  |

Give plain-text templates (emails, CSV, JSON) a plain-text name, and
never give an HTML template one. Use `| e` in a plain-text template
where a value still needs escaping.

## Passing data

Pass plain data: tables, strings, numbers and booleans, nested as you
like. Format values such as dates in Lua before rendering; it keeps
templates simple and the logic testable:

```lua
app:get("/articles", function(req)
    local articles = nitr.db:query(
        "SELECT id, title, created_at FROM articles ORDER BY id DESC"
    )
    for _, a in ipairs(articles) do
        a.date = nitr.time.format(a.created_at, "%d %b %Y")
    end
    return nitr.html(nitr.template:render("articles/index.j2", {
        articles = articles,
    }))
end)
```

## Development and errors

With `nitr dev`, saving a template reloads the app, so a browser
refresh shows the change. In production, templates are loaded once;
apply changes with a [reload](./deployment/#zero-downtime-reload)
(`nitr reload` or `SIGHUP`).

A missing template or a syntax error raises an error with
`kind = "nitr"` that names the template and line, for example
`syntax error: ... (in bad.j2:1)`. It goes to [`on_error`](./errors)
like any other error. `nitr check` does not render templates, so write
a `nitr test` that renders each page to catch mistakes early.
