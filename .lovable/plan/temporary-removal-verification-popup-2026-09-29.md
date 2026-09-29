# Temporary removal verification popup

## Scope
- Show a temporary **Removal Request Already Submitted** popup when a customer opens an action for a finding whose removal request is already submitted.
- Use the supplied wording, status labels, and two document controls.
- Keep existing authorization and submission safeguards unchanged.

## Implementation
- Pass the existing request identifier and status into the action panel.
- For submitted requests, replace duplicate action choices with the verification popup.
- Allow the customer to securely attach one identity document and one signed authorization agreement to their own request.
- Restrict files to PDF, PNG, and JPEG, validate ownership and size on the server, store privately, and record each attachment against the request.
- Show per-document uploaded, uploading, and error states; do not claim verification until review occurs.

## Verification
- Test submitted versus draft request behavior, file validation, and tenant ownership checks.
- Confirm the popup on desktop and mobile and check the latest build status.
