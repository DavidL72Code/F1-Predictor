import { render, screen } from '@testing-library/react'
import App from './App'

test('renders the race predictor landing view', () => {
  render(<App />)
  expect(screen.getByText(/race predictor/i)).toBeInTheDocument()
  expect(screen.getByText(/simulate any f1 race/i)).toBeInTheDocument()
  expect(screen.getByText(/select year \+ circuit above and press predict/i)).toBeInTheDocument()
})
