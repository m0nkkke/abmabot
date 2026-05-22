const seedEmployees = require('./employees.json');
const { saveEmployee } = require('./db');

function validateEmployee(employee, index) {
  if (!employee || typeof employee !== 'object') {
    throw new Error(`Сотрудник с индексом ${index} должен быть объектом`);
  }

  if (!employee.user_id || typeof employee.user_id !== 'string') {
    throw new Error(`У сотрудника с индексом ${index} не заполнено поле user_id`);
  }

  if (employee.fio && typeof employee.fio !== 'string') {
    throw new Error(`У сотрудника с индексом ${index} поле fio должно быть строкой`);
  }

  if (employee.phone && typeof employee.phone !== 'string') {
    throw new Error(`У сотрудника с индексом ${index} поле phone должно быть строкой`);
  }

  if (typeof employee.active !== 'boolean') {
    throw new Error(`У сотрудника с индексом ${index} поле active должно быть true или false`);
  }
}

function seedEmployeesFromJson() {
  seedEmployees.forEach((employee, index) => {
    validateEmployee(employee, index);
    saveEmployee(
      employee.user_id,
      employee.fio || null,
      employee.phone || null,
      employee.active,
      'employees.json'
    );
  });
}

module.exports = { seedEmployeesFromJson };
