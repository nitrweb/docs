# File Uploads

A `file` rule validates an upload the way every other rule validates a
value: declared once, enforced in Rust before the handler runs. The
bytes stream to disk and **never enter the Lua heap**.

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

Two things, both refused at **load time** rather than at the first
upload:

```toml
[multipart]
upload_dir = "/var/lib/myapp/uploads"       # where validated uploads are spooled
```

```lua
input = { body = { schema = Profile, content = { "multipart" } } }
--                                              ^^^^^^^^^^^^^ opt-in
```

- **`[multipart] upload_dir`.** Without it there is no directory to
  spool into, and Nitr will not guess one.
- **`content` including `"multipart"` or `"raw"`.** Accepting file
  uploads is a decision; a schema with a `file` rule and a JSON-only
  body is a contradiction, so it is an error.

The `multipart` [Cargo feature](../../library/cargo-features) must also
be compiled in — it is, in the released binary.

## Presets

Nine one-word starting points. Each returns a **plain rule table** you
can print, copy and edit, and `opts` overrides any key in it.

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
| `S.any_file(opts)`     | Any type — executables still refused      | _required_  |                         |

```lua
avatar   = S.image({ max_bytes = "2mb", aspect = "1:1", required = true }),
manual   = S.document({ max_bytes = "50mb" }),
import   = S.spreadsheet(),
anything = S.any_file({ max_bytes = "10mb" }),
```

Curious what one expands to? Print it:

```lua
nitr.dbg(nitr.validate.image())
-- { type = "file", types = { "image/png", … }, extensions = { "png", … },
--   max_bytes = "5mb", max_pixels = 25000000 }
```

> [!NOTE] `S.video` exceeds the default request limit
>
> Its `max_bytes = "500mb"` is above `[limits] max_file_bytes` (10 MiB)
> and `[limits] max_body_bytes` (1 MiB). A schema bounds one field; the
> `[limits]` section bounds the request, and the smaller of the two
> wins. Raise both if you really accept 500 MB videos.

## Writing a `file` rule by hand

| Key                                                     | Meaning                                                                                 |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `types`                                                 | Media types the file may be. Exact (`"image/png"`), family (`"image/*"`) or `"*/*"`     |
| `extensions`                                            | Extensions the **name** may have (`{ "png", "jpg" }`)                                   |
| `match_extension`                                       | The extension must match the detected type. **On by default** when both lists are given |
| `max_bytes` / `min_bytes`                               | Size bounds. A number, or `"512kb"` / `"2mb"`                                           |
| `allow_executables`                                     | Accept executable formats. Off, and worth leaving off                                   |
| `filename`                                              | A **string rule** applied to the client's file name                                     |
| `min_width` / `max_width` / `min_height` / `max_height` | Image dimensions, read from the header                                                  |
| `max_pixels`                                            | Width × height ceiling — the decompression-bomb guard                                   |
| `aspect`                                                | `"16:9"`, `"1:1"` — within 1%, so 1919×1080 still counts                                |
| `utf8`                                                  | The bytes must be valid UTF-8 text                                                      |

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

`nitr.validate.media_types()` lists every type a `types` list may name,
with each one's extensions and whether its dimensions are readable:

```lua
nitr.dbg(nitr.validate.media_types()["image/png"])
-- { extensions = { "png" }, family = "image", tier = "detected", dimensions = true }
```

## How a file's type is actually decided

Not from what the client said. Nitr looks at the bytes, in three tiers:

| Tier         | How the type is established                                                               |
| ------------ | ----------------------------------------------------------------------------------------- |
| **detected** | A signature in the first bytes — png, jpeg, pdf, zip. **Overrides the declared header**   |
| **text**     | The prefix passes the UTF-8 text sniffer, so the declared subtype (`text/csv`) is trusted |
| **header**   | Nothing detectable; the declared `Content-Type` is all there is                           |

So renaming `payload.exe` to `photo.png` and declaring
`Content-Type: image/png` does not get it past `S.image()` — the
signature says otherwise, and `content_type` in your handler reports
what was found, not what was claimed.

> [!DANGER] Executables are refused by every `types` list
>
> An executable signature never matches `"*/*"`, never matches a family
> wildcard, and never matches an exact type. `allow_executables = true`
> is the only way through, and it exists for the application that
> genuinely distributes binaries.
>
> Two families are refused by wildcard as well: `image/svg+xml`,
> `text/html` and `application/xhtml+xml` are **active content** — a
> browser runs script from them. `"image/*"` will not match an SVG. Name
> it explicitly if you mean it, and Nitr logs a warning at load saying
> you did.

### `match_extension`

When a rule gives both `types` and `extensions`, the two must agree by
default: a file whose bytes are a PNG but whose name ends `.jpg` is
refused. That is what stops a name from being the thing your handler
later trusts.

```lua
{ types = { "image/png" }, extensions = { "png" } }            -- match_extension is on
{ types = { "image/png" }, extensions = { "png" }, match_extension = false }
```

## `nitr.File` — what the handler gets

The value in `req.valid` is a `nitr.File`, not a string. The bytes are on
disk under `[multipart] upload_dir`; nothing was copied into Lua.

| Field / method           | What it is                                                                     |
| ------------------------ | ------------------------------------------------------------------------------ |
| `filename`               | The client's name, **raw** — display text, never a path                        |
| `safe_filename`          | That name reduced to one safe path segment                                     |
| `extension`              | The lowercase last suffix of `safe_filename`                                   |
| `content_type`           | The type **detected from the bytes**                                           |
| `size`                   | Bytes received                                                                 |
| `width` / `height`       | Image dimensions from the header (png, jpeg, gif, webp, bmp, tiff), else `nil` |
| `:save(rel) -> string`   | Moves the file to `rel` inside the upload root; returns the path               |
| `:text() -> string`      | The contents as a string — only within `[limits] max_field_bytes`              |
| `:hash(algo?) -> string` | A hex digest streamed from disk (`sha256`, the default)                        |
| `:discard()`             | Removes the spooled file now                                                   |

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

> [!TIP] You do not have to clean up
>
> A file that is neither saved nor discarded is **removed when the
> request ends**. Spool files never accumulate because a handler took an
> early return, and `:discard()` is for freeing the space sooner, not
> for correctness.

`:save(rel)` resolves `rel` **inside** the upload root. An absolute path,
or one climbing out with `..`, is refused rather than re-rooted — where
a file lands always follows from what your code says.

### `filename` versus `safe_filename`

`filename` is attacker-controlled text: `../../etc/passwd`,
`C:\Windows\evil.exe`, right-to-left overrides that make `gnp.exe`
render as `exe.png`, or nothing at all. It stays raw because
applications legitimately record what the user called their file.

`safe_filename` is that name reduced to something that can only ever
name a file directly inside the upload root: last path segment (both
separators, because the sender's OS is not yours), control characters
and bidirectional overrides and zero-width characters dropped, leading
and trailing dots and spaces trimmed, truncated to the filesystem's
limit **keeping the extension**, and `upload` when nothing survives.

| Sent by the client       | `safe_filename` |
| ------------------------ | --------------- |
| `report.pdf`             | `report.pdf`    |
| `../../etc/passwd`       | `passwd`        |
| `C:\Windows\evil.exe`    | `evil.exe`      |
| `photo\u{202E}gnp.exe`   | `photognp.exe`  |
| `..`, `/`, empty, spaces | `upload`        |

## A whole body as one file

`content = { "raw" }` takes the entire request body as a single file —
`PUT /avatar` with the image bytes and nothing else, the shape a
`curl --data-binary` client or an S3-style API uses.

```lua
app:put("/avatar", function(req)
    local f = req.valid.body            -- a nitr.File, not a table
    return nitr.json({ path = f:save("avatars/" .. req.user .. ".bin"),
                       type = f.content_type })
end, {
    input = { body = { file = nitr.validate.image({ max_bytes = "2mb" }),
                       content = { "raw" } } },
})
```

`schema` and `file` are alternatives: one names the fields of a
structured body, the other says the body _is_ the file.

## Testing an upload

`nitr test` can build a multipart body, so upload validation is testable
without a browser:

```lua
t.it("accepts a small png", function()
    local resp = t.request("POST", "/profile", {
        multipart = {
            name   = "Ada",
            avatar = { filename = "a.png", content_type = "image/png", data = PNG_BYTES },
        },
    })
    t.expect(resp.status).to_equal(200)
end)

t.it("refuses a renamed executable", function()
    local resp = t.request("POST", "/profile", {
        multipart = {
            name   = "Ada",
            avatar = { filename = "a.png", content_type = "image/png", data = ELF_BYTES },
        },
    })
    t.expect(resp.status).to_equal(422)
    t.expect(resp:json().fields["body.avatar"]).to_match("executable")
end)
```

See [Testing](../testing#request-bodies).
