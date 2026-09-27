const destinationCollections: Record<string, string[]> = {
  brazil: [
    'andres-medina-JVUCzgbTjDE-unsplash.jpg', 'cel-sky-eTQGwB1HqxI-unsplash.jpg', 'gustavo-nacht-aUXsL7rDOcw-unsplash.jpg',
    'gustavo-sanchez-d_rFNBFehx4-unsplash.jpg', 'henrique-felix-7HralhQan4s-unsplash.jpg', 'leo-castro-7rZLx5w1Kj0-unsplash.jpg',
  ],
  goa: ['1296x864.jpeg', '3-2.jpeg', 'basilica-of-bom-jesus-goa.webp', 'kishore-v-taVGqBGCAdo-unsplash.jpg', 'olha-kolesnyk-Ngp2bQ97HfA-unsplash.jpg', 'unma-desai-Y8kFw9KkZu0-unsplash.jpg'],
  italy: ['karsten-wurth-9qvZSH_NOQs-unsplash.jpg', 'matthias-schroder-v5ehDfMpUyA-unsplash.jpg', 'miriana-doroban-u-8gO80kMf0kg-unsplash.jpg', 'samuele-bertoli-Mi0Ut6GnS5U-unsplash.jpg', 'simon-nham-EJLwV5mwaSs-unsplash.jpg', 'spencer-davis-ckotRXopwRM-unsplash.jpg'],
  japan: ['josiah-ferraro-IaaKfToXmlQ-unsplash.jpg', 'louie-martinez-IocJwyqRv3M-unsplash.jpg', 'maud-bocquillod-rzBvZs6mQWk-unsplash.jpg', 'shinkansen-2.jpeg', 'stefan-k-62IRMCiDaPY-unsplash.jpg', 'wei-dlD6CdOgVc0-unsplash.jpg'],
  kashmir: ['dhananjay-sharma-ITzcaON6054-unsplash.jpg', 'divya-agrawal-qa8VhqvJGIo-unsplash.jpg', 'prakasam-mathaiyan-NXGjTU2SQWU-unsplash.jpg', 'premium_photo-1697729961187-c70c5f520227.jpeg', 'rahul-kumar-Tn2DLDRSQtw-unsplash.jpg', 'zainab-iqbal-vGHFVH28b3U-unsplash.jpg'],
  kolkata: ['alan-Rw1mRIaujQY-unsplash.jpg', 'arindam-saha-YkbPqaFr9LA-unsplash.jpg', 'prasun-mishra-OSC-vxdmFTQ-unsplash.jpg', 'rajat-sarki-x9kfUPfPVTw-unsplash.jpg', 'shuvam-mitra-U0uvGZlO_NE-unsplash.jpg', 'sohan-rayguru-LWJzxPcNjUA-unsplash.jpg'],
}

function collectionFor(destination: string) {
  const normalized = destination.normalize('NFKD').toLowerCase()
  return Object.entries(destinationCollections).find(([key]) => normalized.includes(key))
}

export function destinationImage(destination: string, index = 0) {
  const match = collectionFor(destination)
  if (!match) return null
  const [key, images] = match
  return `/images/destinations/${key.toUpperCase()}/${images[Math.abs(index) % images.length]}`
}
