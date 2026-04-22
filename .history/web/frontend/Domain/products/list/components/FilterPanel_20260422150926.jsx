Issue 6: Autocomplete requests have no cancellation or stale-response guard, so older responses can overwrite newer input state

Why it is wrong:

fetchAutocompleteOptions allows multiple in-flight requests for the same filter key.
If the user types quickly, an older slower response can arrive after a newer faster response and overwrite the latest options.
This creates result flicker, wrong suggestions, and nondeterministic UI.
In production search/filter UIs, stale-response protection is mandatory.

Impact:

Incorrect autocomplete suggestions.
Merchant confusion when options do not match current input.
Wasted network traffic and scripting time.
Worse perceived performance and trust.

Exact fix:
Use AbortController per filter key and ignore aborted/stale responses.