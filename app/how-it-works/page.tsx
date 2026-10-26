import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "How it works | Translation agent" };

const steps: { actor: "code" | "ai" | "user"; title: string; text: string }[] = [
  { actor: "code", title: "Understand the request", text: "Common language names are matched by code; unusual phrasing goes to the AI." },
  { actor: "code", title: "Open the file", text: "Detects UTF-8 or GBK, the separator, rows and columns." },
  { actor: "code", title: "Pick columns", text: "Rules decide the clear cases; the AI judges only the unclear ones." },
  { actor: "user", title: "Approve the plan", text: "One click before the expensive step. Columns can be switched on or off." },
  { actor: "ai", title: "Translate", text: "Each unique string once, ~40 at a time, every one tagged with an ID." },
  { actor: "code", title: "Check", text: "Placeholders, tags, empty answers, leftover Chinese, runaway length." },
  { actor: "ai", title: "Repair", text: "Only the failed strings go back, with the problem explained." },
  { actor: "code", title: "Build the file", text: "Originals kept, a column per language beside each, a status column." },
];

export default function HowItWorks() {
  return (
    <main className="doc">
      <h1>How the translation agent works</h1>
      <p className="lede">
        Upload a CSV with Chinese text, name the languages you want, and get the same file back with a translated column for each language. This page
        explains how the work is split up, the decisions behind it, and what I'd improve next.
      </p>
      <p className="muted">
        <Link href="/">Try the agent</Link>. The sample file is a 100-row game item table, built to include the cases that trip translation up.
      </p>

      <h2>The design in one sentence</h2>
      <p>
        A fixed workflow with the AI used only where judgment is needed, and plain code everywhere a result can be checked. It is not a free-roaming
        agent that chooses its own next step: for a batch job on a data file, predictable and checkable beats clever.
      </p>
      <ol className="flow">
        {steps.map((s) => (
          <li key={s.title} className={s.actor}>
            <b>{s.title}</b>
            {s.text}
          </li>
        ))}
      </ol>
      <p className="muted" style={{ fontSize: 13 }}>
        <span className="badge code">Code</span> fixed rules with one right answer &nbsp; <span className="badge ai">AI</span> judgment &nbsp;{" "}
        <span className="badge user">You</span> approval. The same colors mark every step in the agent's live trace panel.
      </p>

      <h2>Who does what</h2>
      <p>Each step in technical terms, with a plain-language version alongside.</p>
      <div className="table-scroll">
        <table className="doc-table">
          <thead>
            <tr>
              <th>Step</th>
              <th>What it does</th>
              <th>What could go wrong, and the safeguard</th>
              <th>In plain language</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Understand the request</td>
              <td>Alias match → BCP-47 codes; LLM fallback (fast model) for anything unmatched.</td>
              <td>An unknown language: the AI interprets it; if it still finds none, the agent asks instead of guessing.</td>
              <td>Turns "English and German", "en, de" or "英语和德语" into standard language codes.</td>
            </tr>
            <tr>
              <td>Open the file</td>
              <td>UTF-8 strict decode, gb18030 fallback; delimiter sniffing; every cell kept as a string.</td>
              <td>Broken file: a clear error message.</td>
              <td>Reads files saved by Chinese Excel (GBK) as well as UTF-8, and never turns "007" into 7 or reformats dates.</td>
            </tr>
            <tr>
              <td>Pick columns</td>
              <td>Heuristic on Chinese-cell share, code-likeness and header name; LLM verdict only for the grey zone.</td>
              <td>A wrong pick: shown in the plan with its reason, and you can switch it before anything runs.</td>
              <td>Translates text players see (names, descriptions) and skips data code depends on (IDs, prices, file paths).</td>
            </tr>
            <tr>
              <td>Translate</td>
              <td>Per-column dedup; batches of ≤40 items / 3.5k chars; forced tool call for structured JSON; 4 in parallel; retries with backoff.</td>
              <td>Translations landing on the wrong row: impossible, because answers are matched by ID, not position.</td>
              <td>Sends each different piece of text once, about 40 at a time, as a numbered answer sheet.</td>
            </tr>
            <tr>
              <td>Check</td>
              <td>Deterministic validators: token multiset equality, Han-script and CJK punctuation detection, length ratio.</td>
              <td>Anything that fails goes to repair.</td>
              <td>Proofreads automatically: every string answered, nothing empty, {"{0}"} and {"<color>"} tags intact, no Chinese left behind.</td>
            </tr>
            <tr>
              <td>Repair</td>
              <td>Targeted retry with error feedback; a fix is accepted only if it passes validation.</td>
              <td>Still failing: kept and marked "needs review" in the file, never hidden.</td>
              <td>Re-translates only the failed strings, telling the AI exactly what was wrong.</td>
            </tr>
            <tr>
              <td>Build the file</td>
              <td>
                <code>名称 → 名称_en, 名称_de</code>; <code>translation_status</code>; UTF-8 with BOM.
              </td>
              <td>Garbled characters in Excel: prevented by saving with a marker Excel recognizes.</td>
              <td>Original columns kept, each translated column followed by one column per language, plus a status column.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Key decisions</h2>
      <p>The trade-offs that shaped the product, and when I'd revisit each one.</p>

      <div className="decision">
        <h3>A workflow, not an autonomous agent</h3>
        <div>
          <p>
            The order of steps is fixed in code; the AI is called at four specific points. A free-roaming agent would be slower, costlier and harder to
            trust on a 100-row job where every row must come back.
          </p>
          <p className="tech">Revisit when: requests stop being one shape, e.g. "translate, then post to our CMS and notify QA".</p>
        </div>
      </div>
      <div className="decision">
        <h3>Translate each unique string once</h3>
        <div>
          <p>
            In the sample, 392 Chinese cells contain only 144 different strings ("武器" appears dozens of times). Deduplicating cuts cost and keeps the same
            term translated the same way everywhere.
          </p>
          <p className="tech">Trade-off: identical text is assumed to mean the same thing within a column.</p>
        </div>
      </div>
      <div className="decision">
        <h3>Batches of about 40</h3>
        <div>
          <p>
            One string per call is slow and loses context; the whole file in one call risks a mismatched or cut-off answer. About 40 keeps context and
            stays reliable.
          </p>
          <p className="tech">Revisit when: measuring quality vs. batch size on a real evaluation set.</p>
        </div>
      </div>
      <div className="decision">
        <h3>One call per language</h3>
        <div>
          <p>Translating into English and German separately costs a little more, but each gets the AI's full attention and a failure in one doesn't affect the other.</p>
          <p className="tech">Languages run in parallel, so it isn't slower.</p>
        </div>
      </div>
      <div className="decision">
        <h3>Ask once, before the expensive part</h3>
        <div>
          <p>The plan costs one click but prevents translating an ID column and breaking the game data. It's the only point where the agent waits for you.</p>
        </div>
      </div>
      <div className="decision">
        <h3>Two models, matched to the job</h3>
        <div>
          <p>Claude Sonnet 5.5 translates. The much cheaper Claude Haiku 5.5 handles quick judgments: reading language names, unclear columns, follow-ups.</p>
          <p className="tech">Both are set by environment variables, so swapping models needs no code change.</p>
        </div>
      </div>
      <div className="decision">
        <h3>An AI model, not a machine-translation service</h3>
        <div>
          <p>
            Services like DeepL are cheaper and faster, but weaker at instructions such as "keep {"{0}"} exactly", "this is a game item name" or "use
            informal German".
          </p>
          <p className="tech">Revisit when: volume makes cost dominant; a hybrid (MT draft, AI check) is a natural next step.</p>
        </div>
      </div>
      <div className="decision">
        <h3>The browser runs the steps</h3>
        <div>
          <p>
            Vercel stops any single server request that runs too long, so the browser runs the workflow and calls the server once per batch. Each request
            stays short, and the progress bar and trace are real, not simulated.
          </p>
          <p className="tech">Trade-off: the tab must stay open during a run. Large files would move to a background job.</p>
        </div>
      </div>

      <h2>Interaction design</h2>
      <p>The conversation moves through four states. Chat earns its place after the first result, when you can change your mind in plain words.</p>
      <ol>
        <li>
          <b>Request</b>: attach a CSV and name languages, in either order or the same message. The agent asks for whichever is missing.
        </li>
        <li>
          <b>Plan</b>: file facts, each column with its reason and who decided (rule, AI or you), languages, and the number of AI calls.
        </li>
        <li>
          <b>Progress</b>: a live bar while the trace panel fills in step by step.
        </li>
        <li>
          <b>Result</b>: preview of source beside translations, rows needing review highlighted, and a download button. Follow-ups like "add Japanese",
          "make the German formal" or "redo row 12" re-run only what's needed; "why wasn't icon translated?" gets an answer without re-running.
        </li>
      </ol>
      <h3>When things go wrong</h3>
      <ul>
        <li>No Chinese columns: the agent says so, and you can tick a column manually.</li>
        <li>No language found in a message: it asks, with an example.</li>
        <li>Not a CSV, or a broken file: a specific error, not a crash.</li>
        <li>A batch fails: retried twice; anything still missing is repaired or flagged, and the rest of the file is still delivered.</li>
      </ul>

      <h2>Technology stack</h2>
      <div className="table-scroll">
        <table className="doc-table">
          <thead>
            <tr>
              <th>Layer</th>
              <th>Choice</th>
              <th>Why</th>
              <th>Passed on</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>App</td>
              <td>Next.js (TypeScript)</td>
              <td>The interface and the small server that holds the API key live in one project.</td>
              <td className="tech">Streamlit: quicker to write, but can't run on Vercel.</td>
            </tr>
            <tr>
              <td>Hosting</td>
              <td>Vercel, deployed from GitHub</td>
              <td>Public link on every push; the API key is stored server-side and never reaches the browser.</td>
              <td className="tech">GitHub Pages: static only, which would expose the key.</td>
            </tr>
            <tr>
              <td>Models</td>
              <td>Claude Sonnet 5.5 + Haiku 5.5</td>
              <td>Strong model where quality matters, cheap model for quick decisions.</td>
              <td className="tech">One model for everything: more cost, no gain on simple calls.</td>
            </tr>
            <tr>
              <td>Structured output</td>
              <td>Forced tool calls</td>
              <td>The AI must answer in a fixed format, so there's no free text to parse.</td>
              <td className="tech">Parsing JSON out of prose: fragile.</td>
            </tr>
            <tr>
              <td>CSV</td>
              <td>PapaParse + browser text decoding</td>
              <td>Handles quotes, commas inside cells, line breaks inside cells, and GBK files.</td>
              <td className="tech">Hand-written parsing: breaks on real-world files.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>How I'd know it works</h2>
      <ul>
        <li>
          <b>Row integrity</b>: rows in equals rows out, every time (target: 100%).
        </li>
        <li>
          <b>Placeholder safety</b>: share of strings with all {"{0}"}, %s and tags intact after repair (target: 100%).
        </li>
        <li>
          <b>Column picking accuracy</b> on a labelled set of real files.
        </li>
        <li>
          <b>Flagged rate</b>: share of rows marked "needs review".
        </li>
        <li>
          <b>Human edit rate</b>: how much reviewers change before shipping. The north-star quality signal.
        </li>
        <li>
          <b>Cost and time per 1,000 strings.</b>
        </li>
      </ul>

      <h2>What I'd improve next</h2>
      <p>In priority order; the first three are a first week's work.</p>
      <ol className="priority">
        <li>
          <b>Protect the public link.</b> Today anyone with the URL can spend API credits.
          <span className="tech">Access code, per-IP rate limiting, spending cap.</span>
        </li>
        <li>
          <b>Glossary and translation memory.</b> Lock character names and key terms; never pay twice for a string translated before.
          <span className="tech">Glossary injected into prompts; exact and fuzzy match against past translations.</span>
        </li>
        <li>
          <b>Measure quality, not just safety.</b> Today's checks prove nothing is broken, not that a translation is good.
          <span className="tech">Evaluation set of approved translations; AI reviewer scoring; track human edit rate.</span>
        </li>
        <li>
          <b>Fit the screen.</b> German runs about 30% longer than English; buttons and item names have limits.
          <span className="tech">Per-column max length, enforced in validation and repair.</span>
        </li>
        <li>
          <b>Fix rows in place.</b> Edit flagged cells in the preview instead of only downloading.
          <span className="tech">Inline review UI with edit history, which also feeds the edit-rate metric.</span>
        </li>
        <li>
          <b>Cheaper and faster at volume.</b> Reuse the fixed instructions across calls; use discounted batch processing for jobs that can wait; send very
          short strings to the cheaper model.
          <span className="tech">Prompt caching, Message Batches API, model routing by string length.</span>
        </li>
        <li>
          <b>Big files.</b> Keep running after the tab closes.
          <span className="tech">Background job queue with resumable progress, for 10,000+ rows.</span>
        </li>
        <li>
          <b>More inputs.</b> Excel files, multiple sheets, other source languages.
        </li>
      </ol>
      <div className="callout">
        The biggest current weakness: the checks prove a translation is <i>safe</i>, not that it's <i>good</i>. That's why measuring quality ranks third,
        behind two fixes that are quick and low-risk.
      </div>
    </main>
  );
}
