# AURA

**Plan. Focus. Accept. Thrive.** AURA is a responsive, neurodiversity-affirming daily routine and executive-function support MVP. It externalises working memory and supports autonomy. It is not a diagnostic system, medical device, autism treatment, or substitute for professional or crisis support.

## What was built

- Four-step lightweight onboarding with no diagnostic history.
- A calm Today view with one recommended action, an editable full-day schedule, task completion, skipping, local persistence, and low-demand mode.
- Routine builder with editable activities, times, ordering, optional status, deletion, and morning, afternoon, and evening periods.
- Task breakdown, minimum version, supportive focus timer, sensory and capacity check-in, overload mode, CBT-informed Thought Check, ACT-informed values action, weekly progress, and accessibility settings.
- Mobile bottom navigation and desktop sidebar, large targets, semantic controls, visible focus, reduced-motion CSS, high contrast, adjustable text, and non-colour state labels.
- Installable PWA manifest and browser-first optimistic persistence. Supabase schema and RLS support authenticated cloud sync as the next integration layer.

## Architecture

Next.js App Router and TypeScript provide the application shell. Feature components live under `components/`, domain types under `types/`, pure task logic in `lib/`, and persistent state orchestration in `hooks/`. The demo intentionally works without Supabase credentials. `localStorage` provides immediate offline persistence. The schema uses ownership columns and transitive RLS policies. A production sync adapter can write the same state changes to Supabase with an outbox and conflict resolution.

## Get AURA functional locally

The current MVP is a **local demo application**. You do not need a Supabase
project to use the screens or save Alex's data. Supabase credentials only become
necessary once cloud authentication and synchronisation are connected.

### Prerequisites

- Node.js 20.9 or newer (Node 22 LTS is recommended).
- npm with access to `https://registry.npmjs.org`.

From the repository root, run:

```bash
npm install
npm run doctor
npm run dev
```

Open `http://localhost:3000`. Complete onboarding as Alex, or use the seeded
routine. Data remains in that browser between sessions. Clear the
`aura-state-v1` local storage key in browser developer tools to replay onboarding.

For a production-style local check:

```bash
npm run check
npm run build
npm start
```

Then open `http://localhost:3000` again. `npm run doctor` reports the exact
missing prerequisite when the application cannot start.

### If `npm install` returns HTTP 403

That response is a network or registry policy issue, not an AURA runtime error.
Check the configured registry and proxy:

```bash
npm config get registry
npm config get proxy
npm config get https-proxy
npm ping
```

The registry should normally be `https://registry.npmjs.org/`. On a managed
network, use the organisation's approved npm mirror or ask the administrator to
allow the packages listed in `package.json`. Do not work around organisational
security policy by downloading unverified dependency archives.

### Optional environment file

To prepare for Supabase, copy the example and fill in public project values:

```bash
cp .env.example .env.local
```

Leaving these values unset does not prevent the current local demo from running.

## Supabase

1. Create a Supabase project and copy its URL and anon key into `.env.local`.
2. Link the CLI with `supabase link --project-ref <ref>`.
3. Apply migrations with `supabase db push`.
4. Enable email authentication in the Supabase dashboard. The present demo is local-first; connecting UI authentication and the sync adapter is documented as a known limitation rather than pretending local demo identity is secure authentication.

All AURA tables are prefixed `aura_` so they can safely coexist with the repository's Meeting Hub schema. Every personal table has RLS. Child records are authorised through their owning routine. Thoughts and reflections are not included in third-party analytics.

## Test and quality checks

```bash
npm test
npm run build
```

Tests cover ordering, day selection, low-demand filtering, normal-mode visibility, completion persistence, and task-step persistence. RLS policies in the migration enforce user isolation. Before release, add Playwright flows for account creation, all breakpoints, keyboard-only use, 200% zoom, screen readers, offline reconciliation, and RLS integration against local Supabase.

## Deploy to Vercel

Import the Git repository into Vercel, choose the Next.js preset, set the two public Supabase environment variables, and deploy. Apply Supabase migrations separately before enabling cloud accounts. No server secrets belong in `NEXT_PUBLIC_` variables.

## Evidence-informed and safety decisions

- Concrete prompts, visual sequencing, short exercises, editable plans, minimum versions, and transition-friendly copy reduce cognitive load.
- Thought Check asks for a more complete view without labelling thoughts as distorted. Values work supports chosen action rather than compliance. Sensory distress is treated as valid information.
- Skipping, finishing early, stopping, reducing a plan, and low-demand mode remain available. There are no streak losses, productivity judgements, or masking goals.
- Immediate-help content explicitly directs people to local human support. AURA does not attempt crisis counselling, diagnosis, medication advice, or automated clinical interpretation.

## Privacy and accessibility

Psychological content is sensitive. A commercial deployment needs a privacy impact assessment, retention controls, encrypted export and deletion verification, region-specific consent, and security review. Do not add advertising trackers or log reflection content. Target WCAG 2.2 AA through user research and an external audit. Current foundations include keyboard semantics, labels, focus indicators, contrast, touch sizing, plain language, responsive navigation, and reduced-motion support.

## Known limitations

- Account UI and Supabase sync are not yet wired. The production schema exists, while the MVP uses resilient browser persistence.
- PWA caching and background sync need a service worker and conflict policy.
- Notifications, custom timer input, alternate routine versions, drag-and-drop, export/delete execution, and support-person sharing remain future work.
- Pattern insights use seeded demonstration language, not clinical inference. The date in the polished demo is fixed for a predictable walkthrough.

## Roadmap and validation

Phase 2 should prioritise authenticated sync, explicit trusted-support consent, calendar integration, notifications, offline outbox, personalised sensory strategies, and comprehensive end-to-end/accessibility tests. Later phases may add optional editable AURA Assist planning, wearables, consent-led OT collaboration, and experiment-framed pattern detection.

Before commercial launch, conduct participatory design with autistic adolescents and adults across communication needs, intellectual abilities, cultures, and support contexts. Include safeguarding specialists, OTs, psychologists, privacy counsel, accessibility auditors, and caregivers without displacing autistic decision-making. Validate whether prompts reduce cognitive load, distinguish overload from avoidance safely, avoid demand escalation, work during distress, and remain usable with assistive technology. Run a clinical safety case and jurisdiction-specific regulatory assessment without claiming to treat autism.
