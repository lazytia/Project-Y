/**
 * The pages of the printed menu shown on Menu Knowledge, in reading order.
 *
 * Each entry is a file name under `public/menu/`; the page draws them one under
 * the next, first to last. Adding a page is dropping the image in that folder
 * and appending its name here — the page itself does not change. With no
 * entries Menu Knowledge shows a "coming soon" note instead.
 *
 * Kept in order by hand rather than read from the folder: reading `public/` at
 * run time is not something this host guarantees, and an explicit list is also
 * the only way to say which page comes first.
 *
 * The files are the owner's menu pages (uploaded to Storage as 1.jpg to 14.jpg)
 * re-encoded as WebP at their original 1415x2000. The JPEGs were 1.3-2.4 MB
 * each, 24 MB in all, which is a lot to ask of a phone on mobile data; as WebP
 * the set is about 2 MB and the small print is still sharp when zoomed.
 */
export const MENU_PAGES: readonly string[] = [
  "01.webp", // Small Plates
  "02.webp", // Karaage and sides
  "03.webp", // Sashimi
  "04.webp", // Nigiri
  "05.webp", // Aburi, Babyroll
  "06.webp", // Signature Rolls, Medium Inside-Out Roll
  "07.webp", // Salad
  "08.webp", // Nabe Udon, Tempura
  "09.webp", // Ramen, Udon
  "10.webp", // Curry, Curry Udon
  "11.webp", // Bento Box
  "12.webp", // Regular Bento Box
  "13.webp", // Donburi
  "14.webp", // Donburi, Extra Sauce, Dessert
];

/** Where the files in MENU_PAGES live. */
export const MENU_PAGES_DIR = "/menu";
