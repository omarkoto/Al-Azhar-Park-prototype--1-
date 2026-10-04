// Attribution for photographs taken from Wikimedia Commons (required by their CC licences).
// Keyed by the image file name in src/assets/images.
export interface PhotoCredit {
  author: string
  license: string
  url: string
}

export const photoCredits: Record<string, PhotoCredit> = {
  'events-hero-banner.webp': { author: "Yasser.mahmoud", license: "CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:حـديقة_الازهر_11.jpg" },
  'events-hero-evening.webp': { author: "Yasser.mahmoud", license: "CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:حـديقة_الازهر_11.jpg" },
  'contact-hero-banner.webp': { author: "Djehouty", license: "CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:Al-Azhar-Park_2016-03-28e.jpg" },
  'gallery-palm-avenue-citadel.webp': { author: "Djehouty", license: "CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:Al-Azhar-Park_2016-03-28e.jpg" },
  'gallery-citadel-framed.webp': { author: "Yasser.mahmoud", license: "CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:حـديقة_الازهر_08.jpg" },
  'gallery-citadel-trees.webp': { author: "Aya Mahmoud Naguib Ibrahim", license: "CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:El_azhar_park.jpg" },
  'gallery-garden-terraces.webp': { author: "Sherif Louis Kamel", license: "CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:SLK00013-Azhar_Park_-_Sherif_Louis.jpg" },
  'gallery-lake-pavilion.webp': { author: "Sherif Louis Kamel", license: "CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:SLK09792_HDR-1-Azhar_Park_-_Sherif_Louis.jpg" },
  'gallery-night-avenue.webp': { author: "Yasser.mahmoud", license: "CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:حـديقة_الازهر_12.jpg" },
  'gallery-terrace-view.webp': { author: "Djehouty", license: "CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:Al-Azhar-Park_2016-03-28m.jpg" },
  'gallery-folk-music.webp': { author: "Ahmed Younis Sif Saad", license: "CC BY-SA 3.0", url: "https://commons.wikimedia.org/wiki/File:Oriental_music_band.JPG" },
  'gallery-lawn-picnic.webp': { author: "Sakorty", license: "CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:الفطار_وسط_الطبيعة.jpg" },
  'gallery-star-fountain.webp': { author: "Filip Maljković from Pancevo, Serbia", license: "CC BY-SA 2.0", url: "https://commons.wikimedia.org/wiki/File:Fountains_in_Al_Azhar_Park_(2714876199).jpg" },
  'gallery-promenade-morning.webp': { author: "Radosław Botev", license: "CC BY 3.0 pl", url: "https://commons.wikimedia.org/wiki/File:Al-Azhar_Park_Cairo_(1).jpg" },
  'plan-hero-promenade-dusk.webp': { author: "Yasser.mahmoud", license: "CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:حـديقة_الازهر_09.jpg" },
  'home-hero-citadel-lake.webp': { author: "Kareem Tarek Hussein", license: "CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:مصر_العظيمة.jpg" },
  'wall-969-al-azhar-mosque.webp': { author: "Tentoila", license: "Public domain", url: "https://commons.wikimedia.org/wiki/File:Al-Azhar_(inside)_2006.jpg" },
  'wall-1087-bab-al-futuh.webp': { author: "Djehouty", license: "CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:Cairo_-_Bab_al-Futuh_03.jpg" },
  'wall-ayyubid-al-azhar-park.webp': { author: "R Prazeres", license: "CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:Ayyubid_wall_Cairo_DSCF1591.jpg" },
}
