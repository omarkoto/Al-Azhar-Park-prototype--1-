import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Home } from './pages/Home'
import { About } from './pages/About'
import { Restaurants } from './pages/Restaurants'
import { RestaurantDetail } from './pages/RestaurantDetail'
import { Events } from './pages/Events'
import { EventDetail } from './pages/EventDetail'
import { News } from './pages/News'
import { NewsDetail } from './pages/NewsDetail'
import { Gallery } from './pages/Gallery'
import { Tickets } from './pages/Tickets'
import { Plan } from './pages/Plan'
import { Checkout } from './pages/Checkout'
import { Contact } from './pages/Contact'
import { NotFound } from './pages/NotFound'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="about" element={<About />} />
        <Route path="restaurants" element={<Restaurants />} />
        <Route path="restaurants/:slug" element={<RestaurantDetail />} />
        <Route path="events" element={<Events />} />
        <Route path="events/:slug" element={<EventDetail />} />
        <Route path="news" element={<News />} />
        <Route path="news/:slug" element={<NewsDetail />} />
        <Route path="gallery" element={<Gallery />} />
        <Route path="tickets" element={<Tickets />} />
        <Route path="plan" element={<Plan />} />
        <Route path="visit" element={<Navigate to="/tickets" replace />} />
        <Route path="checkout" element={<Checkout />} />
        <Route path="contact" element={<Contact />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
