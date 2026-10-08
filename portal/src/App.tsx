import { Route, Routes } from 'react-router-dom'
import { Layout, RequireAnyPermission, RequirePermission } from './components/Layout'
import { ContactPage } from './pages/Contact'
import { HoursPage } from './pages/Hours'
import { Home } from './pages/Home'
import { Login } from './pages/Login'
import { ParkPage } from './pages/Park'
import { RolesPage } from './pages/Roles'
import { UsersPage } from './pages/Users'
import { MediaPage } from './pages/Media'
import { EventEditor, EventsPage } from './pages/Events'
import { OrdersPage } from './pages/Orders'
import { GatesPage } from './pages/Gates'
import { ScannerPage } from './pages/Scanner'
import { ScansPage } from './pages/Scans'
import { TicketsPage } from './pages/Tickets'
import { PricesPage } from './pages/Prices'
import { TicketTypesPage } from './pages/TicketTypes'
import { VenuesPage } from './pages/Venues'
import { RestaurantEditor, RestaurantsPage } from './pages/Restaurants'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="park" element={<RequirePermission permission="park:read"><ParkPage /></RequirePermission>} />
        <Route path="contact" element={<RequirePermission permission="contact:read"><ContactPage /></RequirePermission>} />
        <Route path="hours" element={<RequirePermission permission="hours:read"><HoursPage /></RequirePermission>} />
        <Route path="restaurants" element={<RequirePermission permission="restaurants:read"><RestaurantsPage /></RequirePermission>} />
        <Route path="restaurants/:id" element={<RequirePermission permission="restaurants:read"><RestaurantEditor /></RequirePermission>} />
        <Route path="events" element={<RequirePermission permission="events:read"><EventsPage /></RequirePermission>} />
        <Route path="events/:id" element={<RequirePermission permission="events:read"><EventEditor /></RequirePermission>} />
        <Route path="venues" element={<RequirePermission permission="venues:read"><VenuesPage /></RequirePermission>} />
        <Route path="orders" element={<RequirePermission permission="orders:read"><OrdersPage /></RequirePermission>} />
        <Route path="ticket-types" element={<RequirePermission permission="ticket-types:read"><TicketTypesPage /></RequirePermission>} />
        <Route path="prices" element={<RequirePermission permission="pricing:read"><PricesPage /></RequirePermission>} />
        <Route path="tickets" element={<RequirePermission permission="tickets:read"><TicketsPage /></RequirePermission>} />
        <Route path="scans" element={<RequireAnyPermission permissions={['scans:read', 'scans:read_own']}><ScansPage /></RequireAnyPermission>} />
        <Route path="gates" element={<RequirePermission permission="gates:read"><GatesPage /></RequirePermission>} />
        <Route path="scanner" element={<RequirePermission permission="scans:create"><ScannerPage /></RequirePermission>} />
        <Route path="media" element={<RequirePermission permission="media:read"><MediaPage /></RequirePermission>} />
        <Route path="users" element={<RequirePermission permission="users:read"><UsersPage /></RequirePermission>} />
        <Route path="roles" element={<RequirePermission permission="roles:read"><RolesPage /></RequirePermission>} />
        <Route path="*" element={<p className="text-sm text-stone-500">Page not found.</p>} />
      </Route>
    </Routes>
  )
}
