# Restore Web Scan results and add live progress popup

## Scope
- Fix the completed scan state so genuine harmful findings already returned by the scan are visible in the appropriate results section.
- Add a modern modal progress experience when **Run additional scan now** is selected.
- Keep the modal open for the full real scan request, then dismiss it only when the completed result payload is ready to render.
- Show an indeterminate blue progress treatment and rotating scan-stage messages without invented percentages or counts.
- On failure, replace the progress state with a clear retry state rather than displaying a false completion.

## Implementation
- Reconcile the report tab selection and empty states so completed risk and review findings cannot land behind a hidden or removed tab.
- Preserve existing evidence gates: neutral content remains excluded from reputation-risk results, and no finding is upgraded without supporting evidence.
- Build the animation from native interface elements inspired by the supplied references; the uploaded reference images will not be embedded.
- Respect reduced-motion preferences and prevent closing the modal while a scan is active.
- Add focused tests for result routing and scan-progress state where practical.

## Verification
- Run the relevant scan and presentation-filter tests.
- Check the latest application build status.
- Verify the modal and completed-results transition on desktop and mobile preview sizes.
