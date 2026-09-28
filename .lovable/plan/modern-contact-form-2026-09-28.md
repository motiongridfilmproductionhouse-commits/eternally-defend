# Modern contact form

## Scope
- Add a polished inline contact form directly beneath the existing Contact page introduction.
- Keep the existing contact-channel cards and navigation unchanged.
- Reuse the existing secure enquiry submission flow so submissions continue into the current enquiry records and notifications.

## Form experience
- Include enquiry type, full name, work email, mobile number, organization, and message.
- Add clear required-field validation, accessible labels, submission feedback, loading state, and a confirmation state with the enquiry reference.
- Use the current white editorial style, blue accent, fine dividers, and restrained focus/submit micro-interactions across desktop and mobile.

## Technical details
- Build a focused contact-form component and mount it on `/contact`.
- Validate entries in the browser and again through the existing validated server submission function.
- Map each enquiry type to the existing department taxonomy without adding a second lead store.
- Verify the page visually on desktop and mobile, confirm a representative form submission path, and check the latest build status.
