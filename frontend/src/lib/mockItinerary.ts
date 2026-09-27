export type ItineraryItem = { id: string; type: string; icon: string; time: string; title: string; description: string; cost: number; reasoning: string }
export type ItineraryDay = { day: number; date: string; title: string; items: ItineraryItem[] }

export const mockBudget = 2500
export const mockItinerary: ItineraryDay[] = [
  { day: 1, date: 'Friday, 10 October', title: 'Arrive & find your rhythm', items: [
    { id: 'd1-1', type: 'Stay', icon: '⌂', time: '14:00', title: 'Check in at Hotel K5', description: 'A calm, design-led base near Nihonbashi.', cost: 310, reasoning: 'Its quiet rooms and central location make arrival day restorative while keeping tomorrow’s neighbourhoods close.' },
    { id: 'd1-2', type: 'Food', icon: '◒', time: '16:30', title: 'Coffee at Koffee Mameya', description: 'A tailored single-origin tasting in Omotesando.', cost: 18, reasoning: 'This is a compact, high-quality food experience that matches your interest in local craft without overfilling day one.' },
    { id: 'd1-3', type: 'Culture', icon: '◈', time: '18:00', title: 'Meiji Jingu twilight walk', description: 'A leafy shrine visit as the city slows down.', cost: 0, reasoning: 'The route gives you culture and a reset after the flight, with no timed-ticket pressure.' },
    { id: 'd1-4', type: 'Food', icon: '◒', time: '20:00', title: 'Izakaya dinner in Shibuya', description: 'Small plates, grilled skewers and a lively local room.', cost: 55, reasoning: 'A flexible dinner near your evening walk lets you choose the energy level once you arrive.' },
  ] },
  { day: 2, date: 'Saturday, 11 October', title: 'Old Tokyo to neon Tokyo', items: [
    { id: 'd2-1', type: 'Culture', icon: '◈', time: '08:30', title: 'Senso-ji before the crowds', description: 'Explore Asakusa’s temple lanes with an early start.', cost: 0, reasoning: 'Early timing protects a landmark experience from peak crowds and leaves room for spontaneous stops.' },
    { id: 'd2-2', type: 'Food', icon: '◒', time: '10:30', title: 'Street-food tasting at Nakamise', description: 'Try ningyo-yaki and fresh senbei as you wander.', cost: 16, reasoning: 'This turns transit through Asakusa into a food moment instead of adding a separate meal reservation.' },
    { id: 'd2-3', type: 'Explore', icon: '⌘', time: '14:00', title: 'TeamLab Borderless', description: 'Immersive digital art in Azabudai Hills.', cost: 27, reasoning: 'It is the highest-impact visual experience on your route and pairs naturally with your culture and discovery preferences.' },
    { id: 'd2-4', type: 'Nightlife', icon: '✦', time: '19:30', title: 'Golden Gai bar hop', description: 'A guided introduction to tiny Shinjuku bars.', cost: 70, reasoning: 'A small-group guide removes the friction of choosing bars while keeping the night social and adaptable.' },
    { id: 'd2-5', type: 'Food', icon: '◒', time: '22:00', title: 'Late ramen at Ramen Nagi', description: 'Finish with a rich niboshi bowl.', cost: 12, reasoning: 'This is a classic late-night Tokyo ritual a short walk from Golden Gai, not an extra detour.' },
  ] },
  { day: 3, date: 'Sunday, 12 October', title: 'Slow finish & departure', items: [
    { id: 'd3-1', type: 'Wellness', icon: '◌', time: '09:00', title: 'Morning sento soak', description: 'Unwind at a neighbourhood bathhouse.', cost: 8, reasoning: 'A gentle morning balances the previous late night and gives you an authentic daily-life experience.' },
    { id: 'd3-2', type: 'Food', icon: '◒', time: '11:00', title: 'Tsukiji outer market brunch', description: 'Seafood donburi and market snacks.', cost: 32, reasoning: 'The market makes a memorable final meal and works efficiently with an afternoon departure.' },
    { id: 'd3-3', type: 'Explore', icon: '⌘', time: '13:00', title: 'Ginza design stores', description: 'Browse stationery, ceramics and Japanese design.', cost: 0, reasoning: 'This is intentionally open-ended shopping time, so the plan retains flexibility for what you discover.' },
    { id: 'd3-4', type: 'Transit', icon: '→', time: '15:30', title: 'Airport transfer to Haneda', description: 'Pre-booked private transfer from Ginza.', cost: 62, reasoning: 'A fixed transfer removes departure-day uncertainty and keeps your luggage out of the final afternoon.' },
  ] },
]
