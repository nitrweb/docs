# File Uploads

A `file` rule validates an upload like any other field: declared once,
checked in Rust before the handler runs. The bytes are streamed to disk
and **never loaded into Lua memory**.

```lua
local S = nitr.validate

local Profile = S.schema({
    name   = "string|trim|min_len:1|max_len:80|required",
    avatar = S.image({ max_bytes = "2mb", max_width = 4000 }),
})

app:post("/profile", function(req)
    local p = req.valid.body
    local path = p.avatar and p.avatar:save("avatars/" .. req.id .. "-" .. p.avatar.safe_filename)
    return nitr.json({ name = p.name, avatar = path })
end, {
    input = { body = { schema = Profile, content = { "form", "multipart" } } },
})
```

## What a `file` rule needs

```toml
[multipart]
upload_dir = "/var/lib/myapp/uploads"
```

```lua
input = { body = { schema = Profile, content = { "multipart" } } }
--                                              ^^^^^^^^^^^^^ opt-in
```

- **`[multipart] upload_dir`**: where uploads are stored. It must exist,
  be writable, and sit outside the directory of your handler script
  (otherwise an uploaded `.lua` file could be loaded with `require`).
- **`content` with `"multipart"` or `"raw"`**: accepting files is an
  explicit choice.
- **`max_bytes`** on every `file` rule. The presets set it for you.

Each of these is checked when the app loads. The released binary
includes the `multipart` [Cargo feature](../../library/cargo-features)
that uploads need.

## Presets

Ready-made rules for common file kinds. Each returns a plain rule table,
and `opts` overrides any key in it.

| Preset                 | Accepts                                   | `max_bytes` | Also                    |
| ---------------------- | ----------------------------------------- | ----------- | ----------------------- |
| `S.image(opts?)`       | png, jpeg, gif, webp, bmp                 | `5mb`       | `max_pixels = 25000000` |
| `S.document(opts?)`    | pdf, docx, xlsx, pptx, odt, ods, odp, rtf | `20mb`      |                         |
| `S.spreadsheet(opts?)` | xlsx, ods, csv                            | `20mb`      |                         |
| `S.text_file(opts?)`   | txt, csv, md, json, xml, yaml             | `1mb`       | `utf8 = true`           |
| `S.archive(opts?)`     | zip, gzip, tar, bz2, xz, zstd, 7z         | `50mb`      |                         |
| `S.audio(opts?)`       | mp3, wav, ogg, flac, m4a                  | `50mb`      |                         |
| `S.video(opts?)`       | mp4, mov, webm, mkv                       | `500mb`     |                         |
| `S.font(opts?)`        | woff, woff2, ttf, otf                     | `5mb`       |                         |
| `S.any_file(opts)`     | Any type, except executables              | _required_  |                         |

```lua
avatar   = S.image({ max_bytes = "2mb", aspect = "1:1", required = true }),
manual   = S.document({ max_bytes = "50mb" }),
import   = S.spreadsheet(),
anything = S.any_file({ max_bytes = "10mb" }),
```

Print a preset to see its rules:

```lua
nitr.dbg(nitr.validate.image())
-- { type = "file", types = { "image/png", … }, extensions = { "png", "jpg", … },
--   max_bytes = "5mb", max_pixels = 25000000 }
```

> [!NOTE] Request limits still apply
>
> `[limits] max_body_bytes` (1 MiB) caps the whole request, and
> `[limits] max_file_bytes` (10 MiB) caps each file: a file above it
> fails the rule's `max_bytes`, whatever the rule allows. To accept large
> files, such as `S.video`'s 500 MB, raise both limits.

## Writing a `file` rule by hand

| Key                                                     | Meaning                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `types`                                                 | Allowed media types: exact (`"image/png"`), a family (`"image/*"`) or `"*/*"`   |
| `extensions`                                            | Allowed extensions for the file **name** (`{ "png", "jpg" }`)                   |
| `match_extension`                                       | The name's extension must match the detected type. On when both lists are given |
| `max_bytes` / `min_bytes`                               | Size bounds: a number, or `"512kb"` / `"2mb"`. `max_bytes` is required          |
| `allow_executables`                                     | Accept executables. Off by default                                              |
| `filename`                                              | A **string rule** for the client's file name                                    |
| `min_width` / `max_width` / `min_height` / `max_height` | Image dimensions, read from the file header                                     |
| `max_pixels`                                            | Limit on width × height, against decompression bombs                            |
| `aspect`                                                | `"16:9"`, `"1:1"`, within 1% (1919×1080 counts as 16:9)                         |
| `utf8`                                                  | The contents must be valid UTF-8 text                                           |

```lua
{
    logo = { type = "file",
             types = { "image/png", "image/svg+xml" },
             max_bytes = "512kb",
             max_width = 1024, max_height = 1024,
             filename = "string|max_len:100|format:printable" },

    export = { type = "file", types = { "text/csv" }, utf8 = true, max_bytes = "20mb" },
}
```

`nitr.validate.media_types()` lists every type `types` may name, with its
extensions, family, how it is detected (`tier`) and whether its
dimensions can be read:

```lua
nitr.dbg(nitr.validate.media_types()["image/png"])
-- { extensions = { "png" }, family = "image", tier = "detected", dimensions = true }
```

## How the file type is decided

Nitr looks at the bytes, not at what the client claims:

| Tier         | How the type is decided                                                             |
| ------------ | ----------------------------------------------------------------------------------- |
| **detected** | A known signature in the first bytes (png, jpeg, pdf, zip, …). Overrides the header |
| **text**     | The start of the file is valid text, so the declared text type (`text/csv`) is used |
| **header**   | Nothing detectable: the declared `Content-Type` is all there is                     |

So an executable renamed to `photo.png` and sent as `image/png` does not
pass `S.image()`, and `content_type` in your handler is the detected
type.

With both `types` and `extensions`, the name must match the detected type
by default: PNG bytes named `.jpg` are refused. Set
`match_extension = false` to allow that.

> [!DANGER] Executables and active content
>
> Executables are refused by every `types` list, `"*/*"` included. A file
> counts as one by its bytes (ELF, PE, Mach-O, `#!` scripts) or by its
> name (`.exe`, `.bat`, `.js`, …). Only `allow_executables = true` lets
> them through.
>
> `image/svg+xml`, `text/html` and `application/xhtml+xml` can run
> scripts in a browser, so wildcards like `"image/*"` never match them.
> Name the type explicitly if you mean it; Nitr logs a warning when you
> do. Never serve such uploads back inline.

## `nitr.File`: what the handler gets

In `req.valid`, a file field is a `nitr.File`. The bytes stay on disk
under `[multipart] upload_dir`. It has `filename`, `safe_filename`,
`extension`, `content_type` (detected from the bytes), `size`, and
`width`/`height` for images, plus `:save(rel)`, `:text()`, `:hash()` and
`:discard()`. See [`nitr.File`](../../api/types#nitr-file) for details.

```lua
app:post("/upload", function(req)
    local f = req.valid.body.doc
    nitr.log.info("upload", { type = f.content_type, size = f.size, sha = f:hash() })
    local stored = f:save(req.id .. "-" .. f.safe_filename)
    return nitr.json({ path = stored, bytes = f.size })
end, {
    input = { body = { schema = Docs, content = { "multipart" } } },
})
```

`:save(rel)` only writes inside `upload_dir`: an absolute path or one
that climbs out with `..` raises. A file you neither save nor discard is
**deleted when the request ends**, so you never need to clean up.

### `filename` versus `safe_filename`

`filename` is whatever the client sent, such as `../../etc/passwd` or a
name with hidden right-to-left characters. Keep it for display only.
`safe_filename` keeps only the last path segment, removes control and
invisible characters, trims dots and spaces, shortens long names (keeping
the extension), and falls back to `upload`:

| Sent by the client       | `safe_filename` |
| ------------------------ | --------------- |
| `report.pdf`             | `report.pdf`    |
| `../../etc/passwd`       | `passwd`        |
| `C:\Windows\report.pdf`  | `report.pdf`    |
| `photo\u{202E}gnp.txt`   | `photognp.txt`  |
| `..`, `/`, empty, spaces | `upload`        |

## A whole body as one file

`content = { "raw" }` treats the entire request body as one file, as in
`curl --data-binary`. Use `file` instead of `schema`:

```lua
app:put("/avatar", function(req)
    local f = req.valid.body            -- a nitr.File, not a table
    return nitr.json({ path = f:save("avatars/" .. req.user .. ".img"),
                       type = f.content_type })
end, {
    input = { body = { file = nitr.validate.image({ max_bytes = "2mb" }),
                       content = { "raw" } } },
})
```

The declared `Content-Type` is the file's type header, and a
`Content-Disposition: attachment; filename="a.png"` header gives its
name. Without a name, a rule with `extensions` (every preset except
`any_file`) fails, so clients must send that header, or write the rule
without `extensions`.

To test uploads with `nitr test`, see [Testing](../testing#request-bodies).
