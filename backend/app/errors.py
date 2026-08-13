class RegistrationError(RuntimeError):
    pass


class DuplicateRegistrationError(RegistrationError):
    pass


class UnknownRegistrationError(RegistrationError):
    pass
