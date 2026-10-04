# Show CFCICI removal evidence on the dashboard

## Changes
- Extend the existing dashboard removal feed with the saved private thumbnail and confirmed Meta outcome fields.
- Show the thumbnail directly in the top Eterna Protection card, with loading and unavailable states.
- Display the submitted date, escalation, three-video removal result, and Meta report number under the removal entry.
- Correct the top “Removals submitted” total so completed submissions are counted, while the awaiting-platform count remains separate.

## Safety
- Keep evidence private and use the existing authenticated, short-lived signed-link function.
- Preserve the current removal record, permissions, and enforcement controls.

## Verification
- Check the signed-in dashboard at desktop width and confirm the preview, top total, and case outcome are visible.
- Confirm the current build has no errors.
