// ============================================================
// NestIQ — Master Data Layer (Live MongoDB Connection)
// ============================================================

let PROPERTIES = []; 

window.NestApp = {
  isLoaded: false,
  // This guarantees we only fetch data ONCE and everyone waits for it
  fetchData: async function() {
    if (this.isLoaded) return;
    try {
      const response = await fetch(window.API_BASE + '/listings');
      if (!response.ok) throw new Error("Database fetch failed");
      
      const raw = await response.json();
      // Handle both response shapes: plain array (no ?page) or paginated object (with ?page)
      const dbData = Array.isArray(raw) ? raw : (raw.listings || []);

      // Figure out the backend URL so images don't break
      const backendUrl = window.API_BASE ? window.API_BASE.replace('/api', '') : 'http://localhost:5000';

      PROPERTIES = dbData.map(dbItem => {
        // Smart Image Fallback: Ensure relative uploads paths hit port 5000
        let rawImg = dbItem.image || (dbItem.images && dbItem.images.length > 0 ? dbItem.images[0] : null);
        let finalImg = 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=80';
        if (rawImg) {
          finalImg = rawImg.startsWith('http') ? rawImg : backendUrl + rawImg;
        }

        return {
          id: dbItem._id, 
          // Normalize 'sale' to 'buy' so the frontend filter buttons don't hide it!
          intent: dbItem.propertyType === 'sale' ? 'buy' : dbItem.propertyType,
          title: dbItem.title,
          desc: dbItem.description,
          area: dbItem.area,
          city: dbItem.city,
          price: Number(dbItem.price || 0).toLocaleString('en-IN'), 
          priceRaw: Number(dbItem.price || 0), 
          priceUnit: dbItem.priceUnit || (dbItem.propertyType === 'rent' ? '/mo' : 'total'),
          beds: dbItem.bedrooms || 0,
          baths: dbItem.bathrooms || 0,
          sqft: dbItem.sqft || 0,
          img: finalImg,
          images: dbItem.images || [], 
          amenities: dbItem.amenities || [],
          verified: true,
          
          featured: true,

          match: (() => { let s = 0; String(dbItem._id).split('').forEach(c => s += c.charCodeAt(0)); return 85 + (s % 15); })(),
          isNew: true,
          badge: dbItem.propertyType === 'rent' ? 'For Rent' : 'For Sale',
          badgeClass: dbItem.propertyType === 'rent' ? 'badge-rent' : 'badge-buy'
        };
      });
      
      this.isLoaded = true;
      console.log(`✅ NestIQ Engine: Loaded ${PROPERTIES.length} live properties.`);
    } catch (error) {
      console.error("❌ NestIQ Engine Error:", error);
    }
  }
};