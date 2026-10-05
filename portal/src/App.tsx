import { Route, Routes } from 'react-router-dom'
import { Layout, RequirePermission } from './components/Layout'
import { ContactPage } from './pages/Contact'
import { HoursPage } from './pages/Hours'
import { Home } from './pages/Home'
import { Login } from './pages/Login'
import { ParkPage } from './pages/Park'
import { RolesPage } from './pages/Roles'
import { UsersPage } from './pages/Users'
import { MediaPage } from './pages/Media'
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
        <Route path="media" element={<RequirePermission permission="media:read"><MediaPage /></RequirePermission>} />
        <Route path="users" element={<RequirePermission permission="users:read"><UsersPage /></RequirePermission>} />
        <Route path="roles" element={<RequirePermission permission="roles:read"><RolesPage /></RequirePermission>} />
        <Route path="*" element={<p className="text-sm text-stone-500">Page not found.</p>} />
      </Route>
    </Routes>
  )
}
