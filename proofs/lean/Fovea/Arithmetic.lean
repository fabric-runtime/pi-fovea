import Mathlib.Tactic
namespace Fovea

def value (base : Nat) : List Nat → Nat
  | [] => 0
  | x :: xs => x + base * value base xs

def addDigits (base : Nat) : List Nat → List Nat → Nat → List Nat
  | [], [], carry => [carry]
  | x :: xs, [], carry =>
      let total := x + carry
      total % base :: addDigits base xs [] (total / base)
  | [], y :: ys, carry =>
      let total := y + carry
      total % base :: addDigits base [] ys (total / base)
  | x :: xs, y :: ys, carry =>
      let total := x + y + carry
      total % base :: addDigits base xs ys (total / base)

theorem value_addDigits (base : Nat) (xs ys : List Nat) (carry : Nat) :
    value base (addDigits base xs ys carry) = value base xs + value base ys + carry := by
  induction xs generalizing ys carry with
  | nil =>
      induction ys generalizing carry with
      | nil => simp [addDigits, value]
      | cons y ys ih =>
          simp only [addDigits, value]
          rw [ih]
          have h := Nat.mod_add_div (y + carry) base
          simp only [value, Nat.zero_add, Nat.add_zero, Nat.mul_add] at *
          omega
  | cons x xs ih =>
      cases ys with
      | nil =>
          simp only [addDigits, value]
          rw [ih]
          have h := Nat.mod_add_div (x + carry) base
          simp only [value, Nat.zero_add, Nat.add_zero, Nat.mul_add] at *
          omega
      | cons y ys =>
          simp only [addDigits, value]
          rw [ih]
          have h := Nat.mod_add_div (x + y + carry) base
          simp only [value, Nat.zero_add, Nat.add_zero, Nat.mul_add] at *
          omega

def scaleDigits (base digit : Nat) : List Nat → Nat → List Nat
  | [], carry => [carry]
  | x :: xs, carry =>
      let total := x * digit + carry
      total % base :: scaleDigits base digit xs (total / base)

theorem value_scaleDigits (base digit : Nat) (xs : List Nat) (carry : Nat) :
    value base (scaleDigits base digit xs carry) = digit * value base xs + carry := by
  induction xs generalizing carry with
  | nil => simp [scaleDigits, value]
  | cons x xs ih =>
      simp only [scaleDigits, value]
      rw [ih]
      have h := Nat.mod_add_div (x * digit + carry) base
      nlinarith

def multiplyDigits (base : Nat) : List Nat → List Nat → List Nat
  | [], _ => []
  | x :: xs, ys => addDigits base (scaleDigits base x ys 0) (0 :: multiplyDigits base xs ys) 0

theorem value_multiplyDigits (base : Nat) (xs ys : List Nat) :
    value base (multiplyDigits base xs ys) = value base xs * value base ys := by
  induction xs with
  | nil => simp [multiplyDigits, value]
  | cons x xs ih =>
      simp only [multiplyDigits, value_addDigits, value_scaleDigits, value, ih]
      ring

def shiftDigits (places : Nat) (xs : List Nat) : List Nat := List.replicate places 0 ++ xs

theorem value_shiftDigits (base places : Nat) (xs : List Nat) :
    value base (shiftDigits places xs) = base ^ places * value base xs := by
  induction places with
  | zero => simp [shiftDigits]
  | succ n ih =>
      simp only [shiftDigits, List.replicate_succ, List.cons_append, value] at *
      rw [ih]
      ring

-- A most-significant-first division pass, carrying only a bounded remainder.
def msValue (base : Nat) : List Nat → Nat
  | [] => 0
  | x :: xs => x * base ^ xs.length + msValue base xs

def divideDigits (base divisor : Nat) : List Nat → Nat → List Nat × Nat
  | [], remainder => ([], remainder)
  | x :: xs, remainder =>
      let total := remainder * base + x
      let next := divideDigits base divisor xs (total % divisor)
      (total / divisor :: next.1, next.2)

theorem divideDigits_length (base divisor : Nat) (xs : List Nat) (remainder : Nat) :
    (divideDigits base divisor xs remainder).1.length = xs.length := by
  induction xs generalizing remainder with
  | nil => rfl
  | cons x xs ih =>
      simpa only [divideDigits, List.length_cons] using
        congrArg Nat.succ (ih ((remainder * base + x) % divisor))

theorem divideDigits_reconstructs (base divisor : Nat) (xs : List Nat) (remainder : Nat) :
    divisor * msValue base (divideDigits base divisor xs remainder).1 +
      (divideDigits base divisor xs remainder).2 =
      remainder * base ^ xs.length + msValue base xs := by
  induction xs generalizing remainder with
  | nil => simp [divideDigits, msValue]
  | cons x xs ih =>
      simp only [divideDigits, msValue, List.length_cons, divideDigits_length]
      have hi := ih ((remainder * base + x) % divisor)
      have hd := congrArg (fun n => n * base ^ xs.length) (Nat.mod_add_div (remainder * base + x) divisor)
      simp only [pow_succ] at *
      nlinarith

theorem divideDigits_remainder_lt (base divisor : Nat) (hd : 0 < divisor)
    (xs : List Nat) (remainder : Nat) (hr : remainder < divisor) :
    (divideDigits base divisor xs remainder).2 < divisor := by
  induction xs generalizing remainder with
  | nil => exact hr
  | cons x xs ih =>
      simp only [divideDigits]
      exact ih _ (Nat.mod_lt _ hd)

end Fovea
