// TechnoTrainer (youtube.com/@technotrainer) keeps per-game playlists of
// pokédex / catching guides. Keyed by game_family_id; every entry renders as
// an external link in the tracker's info panel footer.
//
// The channel's playlist names aren't uniform ("<game> - Pokédex",
// "<game> - Pokémon Locations", "<game> - How to Catch"), so this map is
// curated by hand from https://www.youtube.com/@technotrainer/playlists.

interface VideoPlaylist {
  label: string;
  url: string;
}

const playlist = (id: string) => `https://www.youtube.com/playlist?list=${id}`;

export const TECHNOTRAINER_PLAYLISTS: Record<string, VideoPlaylist[]> = {
  sword_shield: [
    { label: 'Videos', url: playlist('PLDHidtsnukfJrABK_6qSbRVCSH8b1IkOt') },
  ],
  sword_shield_expansion_pass: [
    { label: 'Videos', url: playlist('PLDHidtsnukfJrABK_6qSbRVCSH8b1IkOt') },
    { label: 'DLC Videos', url: playlist('PLDHidtsnukfJHPX99gh5phHEHT1vHMz5K') },
  ],
  brilliant_diamond_shining_pearl: [
    { label: 'Videos', url: playlist('PLDHidtsnukfKC8LjcPTCeJjMWKq1Ef3u9') },
  ],
  legends_arceus: [
    { label: 'Videos', url: playlist('PLDHidtsnukfLW_QUq3EetzUblYqqwmUNV') },
  ],
  scarlet_violet: [
    { label: 'Videos', url: playlist('PLDHidtsnukfILvvM8PF7haffR-noVV432') },
  ],
  scarlet_violet_expansion_pass: [
    { label: 'Videos', url: playlist('PLDHidtsnukfILvvM8PF7haffR-noVV432') },
    { label: 'DLC Videos', url: playlist('PLDHidtsnukfJFG7wsgVNnZs8K7aUxcrJ1') },
  ],
  legends_z_a: [
    { label: 'Videos', url: playlist('PLDHidtsnukfLRuBkdAabsfWfNgXWh-Ko5') },
  ],
  legends_z_a_mega_dimension: [
    { label: 'Videos', url: playlist('PLDHidtsnukfLRuBkdAabsfWfNgXWh-Ko5') },
  ],
};
