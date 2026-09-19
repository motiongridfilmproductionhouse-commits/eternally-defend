# Premium EIP interactive sections

## Scope
Update only the two requested areas on `/image-immunization`; preserve the header, opening, surrounding content, enquiry flow, and all later EIP sections.

## Identity protection section
- Replace the existing audience grid with the supplied headline, supporting copy, three equal premium audience cards, and a separate confidentiality strip.
- Use custom monochrome line visuals for public figures, organizations, and public-facing individuals without photographs or implied endorsements.
- Add controlled hover/focus movement, internal line tracing, sequential viewport reveal, and full keyboard focus treatment.

## Image lifecycle section
- Add the five-stage lifecycle directly after the audience section, centered on one persistent image-frame abstraction that evolves through the active state.
- On desktop and tablet, provide an accessible five-step selector, progressive connector, active-stage visual, and concise detail panel. Update the active stage from section scroll position while keeping click and keyboard selection available.
- On mobile, render a vertical connected lifecycle and activate stages as they approach the viewport center without sticky trapping.

## Motion and accessibility
- Pause decorative motion outside the viewport and avoid layout-changing transitions.
- Respect reduced-motion preferences by disabling scan, connector, and reveal animation while keeping every stage and explanation readable.
- Use semantic headings, ordered structures, buttons for stage selection, visible focus states, decorative SVGs hidden from assistive technology, and no repeated live announcements.

## Validation
- Check 1440px, 1024px, and 390px layouts for overflow, consistent dimensions, stage activation, hover/focus, and reduced-motion behavior.
- Run TypeScript, lint, and preview build checks. Do not deploy.
