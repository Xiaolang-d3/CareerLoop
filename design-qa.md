# Chat composer redesign QA

final result: passed

## Visual truth and capture

- Selected source: `/Users/kkxny/.codex/generated_images/01a149eb-fa1d-7ae1-8817-5fbb48fa5b77/exec-e5b0f00f-ac7e-4b3a-a701-f6ede8668300.png` (the user's attached selection).
- Implementation: `http://localhost:5173/#/chat/10`, existing CareerLoop application.
- Final screenshot: `/Users/kkxny/CareerLoop/output/product-design/chat-composer-final.png`.
- Source pixels: 1724 × 912. Browser CSS viewport and screenshot: 1456 × 770, one screenshot pixel per CSS pixel. Source downsampled to 1456 × 770 for comparison; the 0.084% aspect ratio difference is immaterial. No browser chrome is included.
- State: authenticated, empty conversation, light theme, default model, no input or attachments, search disabled, menus closed, composer unfocused. Existing logo, avatar, sidebar and account state are preserved.
- Full-view comparison: `/Users/kkxny/CareerLoop/output/product-design/compare-final-full.png`.
- Focused comparison: `/Users/kkxny/CareerLoop/output/product-design/compare-final-composer.png`.
- Both combined comparison images were opened and visually reviewed. They contain the normalized reference and actual browser capture side by side.

## Findings and iteration history

### First comparison — blocked

Evidence: `/Users/kkxny/CareerLoop/output/product-design/compare-v1-full.png` and `/Users/kkxny/CareerLoop/output/product-design/compare-v1-composer.png`, opened together with both artifacts in each image.

- [P2] Composer was 848px wide instead of approximately 896px. A percentage in the shared width variable was evaluated again inside the padded composer. Replaced the empty-page maximum with a fixed 896px ceiling and retained responsive outer gutters.
- [P2] Attachment and search labels inherited the previous 12px toolbar font. Set the empty-page labels to inherit 14px, weight 500, retaining the existing library icons and increasing icon size.
- [P2] Model control surface was too purple and headline too large. Used a subtle neutral surface and reduced the desktop headline ceiling from 44px to 40px.
- [P3] Empty disabled send button was too faint. Increased disabled opacity while preserving the disabled behavior.

### Final comparison — passed

Evidence: final full-view and focused comparisons above. No actionable P0/P1/P2 differences remain. Final frame is 896px wide and 210px high at the desktop viewport; editor, toolbar corners and hint follow the selected composition.

## Required fidelity surfaces

- **Fonts/typography:** existing serif display stack for the headline, 40px desktop ceiling with appropriate Chinese glyphs; existing sans-serif body stack for the 18px subtitle, 22px editor placeholder, 14px tool labels and 12px keyboard hint. Text remains real, editable and selectable. No heading wrapping at tested widths.
- **Spacing/layout:** centered welcome and writing area, generous writing space, left supporting tools and right model/send actions; 20px frame radius, quiet border and shadow. History composer remains 124px tall. Mobile tools and primary actions split into two rows.
- **Colors/tokens:** existing light surfaces, muted secondary text and purple brand tokens. Disabled send is deliberately lighter than the reference's active-looking button because an empty draft cannot submit. Focus treatment remains visible and the decorative orbiting border animation has been removed.
- **Assets/icons:** existing supplied brand logo/avatar reused; existing matching outline icon library used for paperclip, globe and arrow. No new raster assets, custom illustration substitutes or mock screenshots in the UI.
- **Copy/content:** exact selected welcome, subtitle and editor wording. The real configured model identifier `grok-4.7` is preserved instead of replacing it with the mock's presentation label `Grok 4.7`.

## Browser and behavior verification

Verified in the user's existing IAB tab through CUA:

- Desktop empty page, model menu open and Escape close with focus restoration.
- Multiline typing with Shift+Enter, enabled send for a nonempty draft; draft cleared afterward without submission.
- Attachment entry activated; no files uploaded. Existing deterministic tests verify file selection and upload guards.
- Search toggle, category menu open/close, search restored to disabled.
- 390 × 844 and 320 × 740 responsive layouts. At 320px, document width is 320px and composer bounds are x=16..304 (288px), without horizontal overflow or missing controls.
- Mobile evidence: `/Users/kkxny/CareerLoop/output/product-design/chat-composer-mobile.png`.
- Existing history conversation inspected with compact composer and real image results, then returned to conversation 10.
- Browser viewport override reset. Final tab retained as deliverable; no draft or model/search selection left changed.
- Captured browser console warnings/errors: none.
- Real paid model/image requests were not made for this UI verification. Existing mocked tests cover sending, generation, cancellation, model selection, attachment handling and draft restoration.

## Automated checks

- `npm run test`: 62 files, 595 tests passed.
- `npm run build`: TypeScript and Vite production build passed; existing bundle-size advisory only.
- `git diff --check`: passed.

## Follow-up polish

- [P3] Platform serif rendering and the generated reference differ slightly in glyph weight and vertical optical alignment. Existing font tokens were preserved to avoid introducing a new font dependency for one screen.
- [P3] Sidebar and header retain the existing product's exact assets and navigation sizing rather than approximating small variations in the generated concept.

## Implementation checklist

- [x] Selected layout implemented in the existing component.
- [x] Existing functional controls and generation/stop behavior retained.
- [x] Empty and history layouts checked.
- [x] Narrow-screen layouts checked and viewport restored.
- [x] Full-view and focused visual comparisons reviewed after fixes.
- [x] Tests, build and whitespace checks passed.
