# Store Wave 4: mobile storefront and My Items

Wave 4 adds a separate Store row to the Me page without replacing the existing
wallet and legacy ID-store row. Store opens as its own full-screen stack page.

The page follows the app's ruby-and-gold home/profile visual language and contains:

- a non-interactive row showing coin and diamond balances;
- independent Store and My Items tabs;
- catalog sections for game items, chat themes, avatar frames, cars, and custom IDs;
- image cards with duration, both supported prices, owned, unavailable, and sold-out labels;
- a larger preview modal with description, stock, duration, and confirmation before checkout;
- separate coin and diamond purchase choices when the administrator configured both; and
- My Items cards with equipped, active, and expired states plus manual re-equip.

`get-my-store-items` joins server-only ownership records with catalog data. An
ownership remains visible if its catalog item is disabled or unavailable; if the
catalog record is unexpectedly missing, the ownership still appears by item ID.
`equip-store-item` validates active ownership on the server, unequips the current
item in that category, and activates a purchased custom ID when applicable.
