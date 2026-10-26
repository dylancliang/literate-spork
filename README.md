# Translation agent

Upload a CSV with Chinese text, name the languages you want, and get the same file back with a translated column for each language.
The agent picks which columns need translating, shows its plan, translates, checks its own work, and marks anything it couldn't fix.

The app has a **How it works** page covering the agent design, trade-offs, technology choices and next steps.

## Put it online (GitHub + Vercel, about 10 minutes)

You need: a GitHub account, a Vercel account (sign up with GitHub), and an Anthropic API key from [console.anthropic.com](https://console.anthropic.com).

1. **Create the GitHub repo.** Go to [github.com/new](https://github.com/new), name it `translation-agent`, and create it.
   On the empty repo page, choose **uploading an existing file**, drag in everything from this folder, and commit.
   (Or with git: `git init && git add . && git commit -m "Translation agent" && git remote add origin <repo URL> && git push -u origin main`.)
2. **Import it into Vercel.** At [vercel.com/new](https://vercel.com/new), pick the `translation-agent` repo. Vercel detects Next.js; leave the build settings as they are.
3. **Add the API key.** Before deploying, open **Environment Variables** and add:
   - `ANTHROPIC_API_KEY` = your key
4. **Deploy.** You get a link like `translation-agent-yourname.vercel.app`. Open it and press **Try the sample file in English and German**.
5. **Set a spending limit** in the Anthropic console. The link is public, so anyone who has it can run translations on your key.

Every later push to GitHub redeploys automatically. If you change an environment variable, redeploy from the Vercel dashboard.

### Optional settings

| Variable | Default | What it does |
|---|---|---|
| `TRANSLATE_MODEL` | `claude-sonnet-5-5` | Model used for translation |
| `FAST_MODEL` | `claude-haiku-5-5` | Cheaper model for quick decisions (language names, unclear columns, follow-ups) |
| `MOCK_AI` | off | `1` replaces the AI with an obviously fake stand-in for local testing. Never set it on the live site. |

## Run it on your computer

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env.local   # then put your API key in .env.local
npm run dev                  # open http://localhost:3000
```

No key yet? `MOCK_AI=1 npm run dev` lets you click through the whole flow with fake translations.

`npm test` runs the pipeline on the sample file with a stand-in AI and checks column picking, deduplication, placeholder repair, flagging and the output layout.

## What's where

```
app/page.tsx                 the chat screen
app/how-it-works/page.tsx    design write-up
app/api/*/route.ts           the four server calls that use the API key
lib/pipeline.ts              the agent's workflow (runs in the browser)
lib/columns.ts               rules for picking columns
lib/validate.ts              automatic checks on each translation
lib/csv.ts                   reading UTF-8 / GBK files, writing Excel-friendly CSV
lib/server/llm.ts            Claude calls with structured output
components/                  plan, progress, result and trace panels
public/sample_input.csv      100-row test file (made by scripts/make_sample.py)
scripts/test-pipeline.ts     end-to-end test with a stand-in AI
```
